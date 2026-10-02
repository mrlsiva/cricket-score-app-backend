import { Injectable, NotFoundException } from '@nestjs/common';
import { Ball, Innings, Match, Prisma, WicketType } from '@prisma/client';
import { economy, oversText, round2, runRate, strikeRate } from '../../common/utils/cricket.util';
import { CacheService } from '../../infrastructure/redis/cache.service';
import { PrismaService } from '../../prisma/prisma.service';
import { BatLine, EngineBall, EngineConfig, InningsReplay, replayInnings } from './engine/scoring-engine';

type Tx = Prisma.TransactionClient;

export const toEngineBall = (b: Ball): EngineBall => ({
  id: b.id,
  sequence: b.sequence,
  kind: b.kind,
  batsmanId: b.batsmanId,
  nonStrikerId: b.nonStrikerId,
  bowlerId: b.bowlerId,
  runsOffBat: b.runsOffBat,
  extraType: b.extraType,
  extraRuns: b.extraRuns,
  isBoundary: b.isBoundary,
  isWicket: b.isWicket,
  wicketType: b.wicketType,
  dismissedPlayerId: b.dismissedPlayerId,
  fielderId: b.fielderId,
});

export const engineConfig = (m: Pick<Match, 'ballsPerOver' | 'wideRuns' | 'noBallRuns'>): EngineConfig => ({
  ballsPerOver: m.ballsPerOver,
  wideRuns: m.wideRuns,
  noBallRuns: m.noBallRuns,
});

export function dismissalText(l: Pick<BatLine, 'isOut' | 'retiredHurt' | 'wicketType' | 'bowlerId' | 'fielderId'>, names: Record<string, string>) {
  const n = (id: string | null) => (id ? (names[id] ?? '?') : '');
  if (l.retiredHurt && !l.isOut) return 'retired hurt';
  if (!l.isOut) return 'not out';
  switch (l.wicketType as WicketType) {
    case 'BOWLED':
      return `b ${n(l.bowlerId)}`;
    case 'CAUGHT':
      return l.fielderId && l.fielderId === l.bowlerId ? `c & b ${n(l.bowlerId)}` : `c ${n(l.fielderId) || 'sub'} b ${n(l.bowlerId)}`;
    case 'LBW':
      return `lbw b ${n(l.bowlerId)}`;
    case 'RUN_OUT':
      return l.fielderId ? `run out (${n(l.fielderId)})` : 'run out';
    case 'STUMPED':
      return `st ${n(l.fielderId)} b ${n(l.bowlerId)}`;
    case 'HIT_WICKET':
      return `hit wicket b ${n(l.bowlerId)}`;
    case 'TIMED_OUT':
      return 'timed out';
    default:
      return 'out';
  }
}

@Injectable()
export class MatchStateService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  snapshotKey(matchId: string) {
    return `live:${matchId}`;
  }

  async names(matchId: string, tx: Tx = this.prisma): Promise<Record<string, string>> {
    const rows = await tx.matchPlayer.findMany({ where: { matchId }, select: { player: { select: { id: true, name: true } } } });
    const balls = await tx.ball.findMany({
      where: { matchId },
      select: { batsmanId: true, nonStrikerId: true, bowlerId: true, fielderId: true, dismissedPlayerId: true },
      distinct: ['batsmanId', 'bowlerId', 'fielderId'],
    });
    const map: Record<string, string> = {};
    rows.forEach((r) => (map[r.player.id] = r.player.name));
    const missing = new Set<string>();
    balls.forEach((b) => [b.batsmanId, b.nonStrikerId, b.bowlerId, b.fielderId, b.dismissedPlayerId].forEach((id) => id && !map[id] && missing.add(id)));
    if (missing.size) {
      const extra = await tx.player.findMany({ where: { id: { in: [...missing] } }, select: { id: true, name: true } });
      extra.forEach((p) => (map[p.id] = p.name));
    }
    return map;
  }

  async inningsBalls(inningsId: string, tx: Tx = this.prisma) {
    return tx.ball.findMany({ where: { inningsId, deletedAt: null }, orderBy: { sequence: 'asc' } });
  }

  /**
   * Replays an innings from its ball log and persists every derived value:
   * ball numbering, innings totals, partnerships and the match's player statistics.
   */
  async recalculate(match: Match, innings: Innings, tx: Tx = this.prisma): Promise<InningsReplay> {
    const balls = await this.inningsBalls(innings.id, tx);
    const replay = replayInnings(balls.map(toEngineBall), engineConfig(match));

    const byId = new Map(balls.map((b) => [b.id, b]));
    for (const c of replay.balls) {
      const b = byId.get(c.id)!;
      if (
        b.overNumber !== c.overNumber ||
        b.ballInOver !== c.ballInOver ||
        b.isLegal !== c.isLegal ||
        b.totalRuns !== c.totalRuns ||
        b.isFour !== c.isFour ||
        b.isSix !== c.isSix ||
        b.scoreAfter !== c.scoreAfter ||
        b.wicketsAfter !== c.wicketsAfter
      ) {
        await tx.ball.update({
          where: { id: c.id },
          data: {
            overNumber: c.overNumber,
            ballInOver: c.ballInOver,
            isLegal: c.isLegal,
            totalRuns: c.totalRuns,
            isFour: c.isFour,
            isSix: c.isSix,
            scoreAfter: c.scoreAfter,
            wicketsAfter: c.wicketsAfter,
          },
        });
      }
    }

    const t = replay.totals;
    await tx.innings.update({
      where: { id: innings.id },
      data: {
        runs: t.runs,
        wickets: t.wickets,
        legalBalls: t.legalBalls,
        completedOvers: t.completedOvers,
        ballsInOver: t.ballsInOver,
        wides: t.wides,
        noBalls: t.noBalls,
        byes: t.byes,
        legByes: t.legByes,
        penaltyRuns: t.penaltyRuns,
      },
    });

    await tx.partnership.deleteMany({ where: { inningsId: innings.id } });
    if (replay.partnerships.length) {
      await tx.partnership.createMany({ data: replay.partnerships.map((p) => ({ ...p, inningsId: innings.id, matchId: match.id })) });
    }

    // keep the chasing side's target in sync if an earlier innings was edited
    if (innings.number % 2 === 1) {
      await tx.innings.updateMany({ where: { matchId: match.id, number: innings.number + 1 }, data: { target: t.runs + 1 } });
    }

    await this.rebuildPlayerMatchStats(match.id, tx);
    await this.cache.del(this.snapshotKey(match.id));
    return replay;
  }

  /** Aggregates batting / bowling / fielding per player for the whole match (super overs excluded). */
  async rebuildPlayerMatchStats(matchId: string, tx: Tx = this.prisma) {
    const match = await tx.match.findUniqueOrThrow({ where: { id: matchId } });
    const [squad, innings, names] = await Promise.all([
      tx.matchPlayer.findMany({ where: { matchId } }),
      tx.innings.findMany({ where: { matchId, isSuperOver: false }, orderBy: { number: 'asc' } }),
      this.names(matchId, tx),
    ]);
    const balls = await tx.ball.findMany({ where: { matchId, deletedAt: null, innings: { isSuperOver: false } }, orderBy: { sequence: 'asc' } });

    type Row = Prisma.PlayerMatchStatsCreateManyInput;
    const rows = new Map<string, Row>();
    const row = (playerId: string, teamId: string): Row => {
      let r = rows.get(playerId);
      if (!r) {
        r = { matchId, playerId, teamId };
        rows.set(playerId, r);
      }
      return r;
    };
    squad.forEach((s) => row(s.playerId, s.teamId));

    for (const inn of innings) {
      const replay = replayInnings(balls.filter((b) => b.inningsId === inn.id).map(toEngineBall), engineConfig(match));
      for (const l of replay.batting) {
        const r = row(l.playerId, inn.battingTeamId);
        Object.assign(r, {
          batted: true,
          battingPosition: l.position,
          runs: (r.runs ?? 0) + l.runs,
          ballsFaced: (r.ballsFaced ?? 0) + l.balls,
          fours: (r.fours ?? 0) + l.fours,
          sixes: (r.sixes ?? 0) + l.sixes,
          dots: (r.dots ?? 0) + l.dots,
          isOut: l.isOut,
          wicketType: l.wicketType,
          dismissedById: l.bowlerId,
          fielderId: l.fielderId,
          dismissalText: dismissalText(l, names),
        });
      }
      for (const l of replay.bowling) {
        const r = row(l.playerId, inn.bowlingTeamId);
        Object.assign(r, {
          bowled: true,
          ballsBowled: (r.ballsBowled ?? 0) + l.balls,
          runsConceded: (r.runsConceded ?? 0) + l.runs,
          wickets: (r.wickets ?? 0) + l.wickets,
          maidens: (r.maidens ?? 0) + l.maidens,
          widesBowled: (r.widesBowled ?? 0) + l.wides,
          noBallsBowled: (r.noBallsBowled ?? 0) + l.noBalls,
          dotsBowled: (r.dotsBowled ?? 0) + l.dots,
        });
      }
      for (const l of replay.fielding) {
        const r = row(l.playerId, inn.bowlingTeamId);
        Object.assign(r, {
          catches: (r.catches ?? 0) + l.catches,
          runOuts: (r.runOuts ?? 0) + l.runOuts,
          stumpings: (r.stumpings ?? 0) + l.stumpings,
        });
      }
    }

    await tx.playerMatchStats.deleteMany({ where: { matchId } });
    if (rows.size) await tx.playerMatchStats.createMany({ data: [...rows.values()] });
  }

  // ─────────────── Read models ───────────────

  private batView(l: BatLine | undefined, id: string | null, names: Record<string, string>) {
    if (!id) return null;
    return {
      id,
      name: names[id] ?? 'Unknown',
      runs: l?.runs ?? 0,
      balls: l?.balls ?? 0,
      fours: l?.fours ?? 0,
      sixes: l?.sixes ?? 0,
      strikeRate: strikeRate(l?.runs ?? 0, l?.balls ?? 0),
    };
  }

  async snapshot(matchId: string) {
    const cached = await this.cache.get(this.snapshotKey(matchId));
    if (cached) return cached;
    const snap = await this.buildSnapshot(matchId);
    await this.cache.set(this.snapshotKey(matchId), snap, 300);
    return snap;
  }

  async invalidate(matchId: string) {
    await this.cache.del(this.snapshotKey(matchId));
  }

  /** Compact live-score payload consumed by the Android app and broadcast on every ball. */
  async buildSnapshot(matchId: string) {
    const match = await this.prisma.match.findFirst({
      where: { id: matchId, deletedAt: null },
      include: {
        teamA: { select: { id: true, name: true, shortName: true, logoUrl: true, color: true } },
        teamB: { select: { id: true, name: true, shortName: true, logoUrl: true, color: true } },
        tossWinner: { select: { name: true } },
        innings: { orderBy: { number: 'asc' } },
        scorerLock: { select: { user: { select: { id: true, name: true } } } },
        tournament: { select: { id: true, name: true } },
      },
    });
    if (!match) throw new NotFoundException('Match not found');
    const bpo = match.ballsPerOver;
    const cur = match.innings.at(-1);
    const names = await this.names(matchId);

    let current: Record<string, unknown> | null = null;
    if (cur) {
      const replay = replayInnings((await this.inningsBalls(cur.id)).map(toEngineBall), engineConfig(match));
      const bat = new Map(replay.batting.map((l) => [l.playerId, l]));
      const bowlLine = replay.bowling.find((l) => l.playerId === cur.bowlerId);
      const lastBowlerId = cur.bowlerId ?? cur.previousBowlerId;
      const lastBowler = replay.bowling.find((l) => l.playerId === lastBowlerId);
      const partial = replay.overs.find((o) => o.overNumber === cur.completedOvers);
      const quotaBalls = cur.maxOvers * bpo;
      const usedBalls = cur.completedOvers * bpo + cur.ballsInOver;
      const ballsRemaining = Math.max(0, quotaBalls - usedBalls);
      const requiredRuns = cur.target ? Math.max(0, cur.target - cur.runs) : null;
      const p = replay.partnerships.at(-1);
      const fow = replay.fallOfWickets.at(-1);
      current = {
        inningsId: cur.id,
        inningsNumber: cur.number,
        isSuperOver: cur.isSuperOver,
        status: cur.status,
        battingTeamId: cur.battingTeamId,
        bowlingTeamId: cur.bowlingTeamId,
        score: `${cur.runs}/${cur.wickets}`,
        runs: cur.runs,
        wickets: cur.wickets,
        overs: `${cur.completedOvers}.${cur.ballsInOver}`,
        maxOvers: cur.maxOvers,
        runRate: runRate(cur.runs, cur.legalBalls, bpo),
        projectedScore: cur.target ? null : Math.round(runRate(cur.runs, cur.legalBalls, bpo) * cur.maxOvers),
        target: cur.target,
        requiredRuns,
        ballsRemaining,
        requiredRunRate: requiredRuns !== null && ballsRemaining > 0 ? round2((requiredRuns / ballsRemaining) * bpo) : null,
        equation: requiredRuns !== null && cur.status === 'IN_PROGRESS' ? `Need ${requiredRuns} run${requiredRuns === 1 ? '' : 's'} from ${ballsRemaining} ball${ballsRemaining === 1 ? '' : 's'}` : null,
        extras: { total: replay.totals.extras, wides: cur.wides, noBalls: cur.noBalls, byes: cur.byes, legByes: cur.legByes, penalty: cur.penaltyRuns },
        striker: this.batView(bat.get(cur.strikerId ?? ''), cur.strikerId, names),
        nonStriker: this.batView(bat.get(cur.nonStrikerId ?? ''), cur.nonStrikerId, names),
        bowler: (bowlLine ?? lastBowler)
          ? {
              id: (bowlLine ?? lastBowler)!.playerId,
              name: names[(bowlLine ?? lastBowler)!.playerId],
              isCurrent: !!bowlLine,
              overs: oversText((bowlLine ?? lastBowler)!.balls, bpo),
              maidens: (bowlLine ?? lastBowler)!.maidens,
              runs: (bowlLine ?? lastBowler)!.runs,
              wickets: (bowlLine ?? lastBowler)!.wickets,
              economy: economy((bowlLine ?? lastBowler)!.runs, (bowlLine ?? lastBowler)!.balls, bpo),
            }
          : null,
        needsNewBatsman: cur.status === 'IN_PROGRESS' && (!cur.strikerId || !cur.nonStrikerId),
        needsNewBowler: cur.status === 'IN_PROGRESS' && !cur.bowlerId,
        previousBowlerId: cur.previousBowlerId,
        thisOver: partial && !partial.isComplete ? partial.balls : [],
        recentOvers: replay.overs.slice(-5).map((o) => ({ over: o.overNumber + 1, runs: o.runs, wickets: o.wickets, balls: o.balls })),
        partnership: p?.isUnbroken ? { runs: p.runs, balls: p.balls, batter1: names[p.batter1Id], batter2: names[p.batter2Id] } : null,
        lastWicket: fow
          ? { player: names[fow.playerId], score: fow.score, over: fow.overLabel, runs: bat.get(fow.playerId)?.runs ?? 0, balls: bat.get(fow.playerId)?.balls ?? 0 }
          : null,
      };
    }

    return {
      match: {
        id: match.id,
        name: match.name,
        status: match.status,
        isPaused: match.isPaused,
        pauseReason: match.pauseReason,
        tournament: match.tournament,
        teamA: match.teamA,
        teamB: match.teamB,
        overs: match.overs,
        ballsPerOver: bpo,
        ground: match.ground,
        tossText: match.tossWinner && match.tossDecision ? `${match.tossWinner.name} won the toss and chose to ${match.tossDecision === 'BAT' ? 'bat' : 'bowl'}` : null,
        resultType: match.resultType,
        resultText: match.resultText,
        winnerTeamId: match.winnerTeamId,
        scorer: match.scorerLock?.user ?? null,
      },
      innings: match.innings.map((i) => ({
        id: i.id,
        number: i.number,
        isSuperOver: i.isSuperOver,
        battingTeamId: i.battingTeamId,
        score: `${i.runs}/${i.wickets}`,
        overs: `${i.completedOvers}.${i.ballsInOver}`,
        runRate: runRate(i.runs, i.legalBalls, bpo),
        target: i.target,
        status: i.status,
      })),
      current,
      updatedAt: new Date().toISOString(),
    };
  }

  /** Full scorecard for all innings. */
  async scorecard(matchId: string) {
    const match = await this.prisma.match.findFirst({
      where: { id: matchId, deletedAt: null },
      include: {
        teamA: { select: { id: true, name: true, shortName: true, logoUrl: true } },
        teamB: { select: { id: true, name: true, shortName: true, logoUrl: true } },
        tossWinner: { select: { name: true } },
        tournament: { select: { id: true, name: true } },
        innings: { orderBy: { number: 'asc' } },
        players: { orderBy: { battingOrder: 'asc' } },
        awards: { include: { player: { select: { id: true, name: true } }, secondPlayer: { select: { id: true, name: true } } } },
      },
    });
    if (!match) throw new NotFoundException('Match not found');
    const names = await this.names(matchId);
    const teamName = (id: string) => (id === match.teamAId ? match.teamA.name : match.teamB.name);
    const bpo = match.ballsPerOver;
    const allBalls = await this.prisma.ball.findMany({ where: { matchId, deletedAt: null }, orderBy: { sequence: 'asc' } });

    const innings = match.innings.map((inn) => {
      const r = replayInnings(allBalls.filter((b) => b.inningsId === inn.id).map(toEngineBall), engineConfig(match));
      const batted = new Set(r.batting.map((b) => b.playerId));
      return {
        id: inn.id,
        number: inn.number,
        isSuperOver: inn.isSuperOver,
        status: inn.status,
        battingTeam: { id: inn.battingTeamId, name: teamName(inn.battingTeamId) },
        bowlingTeam: { id: inn.bowlingTeamId, name: teamName(inn.bowlingTeamId) },
        total: { runs: inn.runs, wickets: inn.wickets, overs: `${inn.completedOvers}.${inn.ballsInOver}`, runRate: runRate(inn.runs, inn.legalBalls, bpo) },
        target: inn.target,
        extras: { total: r.totals.extras, wides: inn.wides, noBalls: inn.noBalls, byes: inn.byes, legByes: inn.legByes, penalty: inn.penaltyRuns },
        batting: r.batting.map((l) => ({
          playerId: l.playerId,
          name: names[l.playerId],
          dismissal: dismissalText(l, names),
          runs: l.runs,
          balls: l.balls,
          fours: l.fours,
          sixes: l.sixes,
          strikeRate: strikeRate(l.runs, l.balls),
          isOut: l.isOut,
        })),
        didNotBat: match.players.filter((p) => p.teamId === inn.battingTeamId && !batted.has(p.playerId)).map((p) => ({ playerId: p.playerId, name: names[p.playerId] })),
        fallOfWickets: r.fallOfWickets.map((f) => ({ ...f, name: names[f.playerId] })),
        bowling: r.bowling.map((l) => ({
          playerId: l.playerId,
          name: names[l.playerId],
          overs: oversText(l.balls, bpo),
          maidens: l.maidens,
          runs: l.runs,
          wickets: l.wickets,
          economy: economy(l.runs, l.balls, bpo),
          wides: l.wides,
          noBalls: l.noBalls,
          dots: l.dots,
        })),
        partnerships: r.partnerships.map((p) => ({
          wicketNumber: p.wicketNumber,
          runs: p.runs,
          balls: p.balls,
          batter1: { id: p.batter1Id, name: names[p.batter1Id], runs: p.batter1Runs, balls: p.batter1Balls },
          batter2: { id: p.batter2Id, name: names[p.batter2Id], runs: p.batter2Runs, balls: p.batter2Balls },
          isUnbroken: p.isUnbroken,
        })),
        overs: r.overs,
      };
    });

    return {
      match: {
        id: match.id,
        name: match.name,
        status: match.status,
        teamA: match.teamA,
        teamB: match.teamB,
        tournament: match.tournament,
        ground: match.ground,
        scheduledAt: match.scheduledAt,
        overs: match.overs,
        tossText: match.tossWinner && match.tossDecision ? `${match.tossWinner.name} won the toss and chose to ${match.tossDecision === 'BAT' ? 'bat' : 'bowl'}` : null,
        resultText: match.resultText,
        umpireName: match.umpireName,
      },
      innings,
      awards: match.awards,
    };
  }

  /** Worm (cumulative) and Manhattan (per over) graph data per innings. */
  async graphs(matchId: string) {
    const match = await this.prisma.match.findFirst({ where: { id: matchId, deletedAt: null }, include: { innings: { orderBy: { number: 'asc' } } } });
    if (!match) throw new NotFoundException('Match not found');
    const allBalls = await this.prisma.ball.findMany({ where: { matchId, deletedAt: null }, orderBy: { sequence: 'asc' } });
    return match.innings.map((inn) => {
      const r = replayInnings(allBalls.filter((b) => b.inningsId === inn.id).map(toEngineBall), engineConfig(match));
      return {
        inningsNumber: inn.number,
        battingTeamId: inn.battingTeamId,
        isSuperOver: inn.isSuperOver,
        worm: [{ over: 0, runs: 0, wickets: 0 }, ...r.overs.map((o) => ({ over: o.overNumber + (o.isComplete ? 1 : o.legalBalls / match.ballsPerOver), runs: o.cumulativeRuns, wickets: o.cumulativeWickets }))],
        manhattan: r.overs.map((o) => ({ over: o.overNumber + 1, runs: o.runs, wickets: o.wickets })),
        fallOfWickets: r.fallOfWickets,
      };
    });
  }
}
