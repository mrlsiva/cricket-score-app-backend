import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { AwardType, Prisma } from '@prisma/client';
import { AuthUser } from '../../common/interfaces/auth-user.interface';
import { economy, round2, strikeRate } from '../../common/utils/cricket.util';
import { PrismaService } from '../../prisma/prisma.service';
import { AccessService } from '../access/access.service';
import { AuditService } from '../audit/audit.service';
import { impactPoints } from './mvp-calculator';

type Candidate = { playerId: string; teamId?: string | null; value: string; points?: number; secondPlayerId?: string };

const MATCH_AWARD_TYPES: AwardType[] = ['MAN_OF_THE_MATCH', 'BEST_BATSMAN', 'BEST_BOWLER', 'BEST_FIELDER', 'MOST_SIXES', 'MOST_FOURS', 'HIGHEST_PARTNERSHIP'];

const best = <T>(rows: T[], score: (r: T) => number, tie?: (r: T) => number) =>
  rows.reduce<T | null>((acc, r) => {
    if (!acc) return r;
    const d = score(r) - score(acc);
    if (d > 0) return r;
    if (d === 0 && tie && tie(r) > tie(acc)) return r;
    return acc;
  }, null);

@Injectable()
export class AwardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
  ) {}

  private async upsert(scope: 'MATCH' | 'TOURNAMENT', key: { matchId?: string; tournamentId?: string }, type: AwardType, c: Candidate | null) {
    const where = scope === 'MATCH' ? { matchId_type: { matchId: key.matchId!, type } } : { tournamentId_type: { tournamentId: key.tournamentId!, type } };
    const existing = await this.prisma.award.findUnique({ where });
    if (existing?.isOverridden) return;
    if (!c) {
      if (existing) await this.prisma.award.delete({ where: { id: existing.id } });
      return;
    }
    const data = {
      playerId: c.playerId,
      secondPlayerId: c.secondPlayerId ?? null,
      teamId: c.teamId ?? null,
      value: c.value,
      points: c.points !== undefined ? new Prisma.Decimal(c.points) : null,
    };
    if (existing) await this.prisma.award.update({ where: { id: existing.id }, data });
    else await this.prisma.award.create({ data: { scope, type, ...key, ...data } });
  }

  /** Computes impact points for every player of the match and the automatic match awards. */
  async computeMatchAwards(matchId: string) {
    const match = await this.prisma.match.findUnique({ where: { id: matchId }, include: { innings: { where: { isSuperOver: false } } } });
    if (!match) return;
    if (match.deletedAt || match.status !== 'COMPLETED' || !['WIN', 'TIE'].includes(match.resultType ?? '')) {
      await this.prisma.award.deleteMany({ where: { matchId, isOverridden: false } });
      await this.prisma.match.update({ where: { id: matchId }, data: { mvpPlayerId: null } });
      return;
    }
    const totalRuns = match.innings.reduce((s, i) => s + i.runs, 0);
    const totalBalls = match.innings.reduce((s, i) => s + i.legalBalls, 0);
    const matchRunRate = totalBalls ? totalRuns / (totalBalls / match.ballsPerOver) : 8;

    const rows = await this.prisma.playerMatchStats.findMany({ where: { matchId }, include: { player: { select: { name: true } } } });
    const scored = rows.map((r) => ({ row: r, pts: impactPoints(r, matchRunRate, match.ballsPerOver) }));
    await this.prisma.$transaction(
      scored.map(({ row, pts }) =>
        this.prisma.playerMatchStats.update({
          where: { id: row.id },
          data: { battingPoints: pts.batting, bowlingPoints: pts.bowling, fieldingPoints: pts.fielding, mvpPoints: pts.total },
        }),
      ),
    );

    const winnerBonus = (r: (typeof rows)[number]) => (r.teamId === match.winnerTeamId ? 1 : 0);
    const mvp = best(scored, (s) => s.pts.total, (s) => winnerBonus(s.row) * 1000 + s.row.runs);
    const batsman = best(rows.filter((r) => r.batted && r.runs > 0), (r) => r.runs, (r) => -r.ballsFaced);
    const bowlers = rows.filter((r) => r.bowled);
    const bowler = best(bowlers.filter((r) => r.wickets > 0), (r) => r.wickets, (r) => -r.runsConceded) ?? best(bowlers.filter((r) => r.ballsBowled >= match.ballsPerOver), (r) => -economy(r.runsConceded, r.ballsBowled, match.ballsPerOver));
    const fielder = best(rows.filter((r) => r.catches + r.runOuts + r.stumpings > 0), (r) => r.catches + r.runOuts + r.stumpings, (r) => r.runOuts + r.stumpings);
    const sixes = best(rows.filter((r) => r.sixes > 0), (r) => r.sixes, (r) => r.runs);
    const fours = best(rows.filter((r) => r.fours > 0), (r) => r.fours, (r) => r.runs);
    const partnership = await this.prisma.partnership.findFirst({
      where: { matchId, innings: { isSuperOver: false } },
      orderBy: [{ runs: 'desc' }, { balls: 'asc' }],
      include: { innings: { select: { battingTeamId: true } } },
    });

    const key = { matchId };
    const bat = (r: (typeof rows)[number]) => `${r.runs}${r.isOut ? '' : '*'} (${r.ballsFaced})`;
    await this.upsert('MATCH', key, 'MAN_OF_THE_MATCH', mvp && { playerId: mvp.row.playerId, teamId: mvp.row.teamId, value: `${mvp.pts.total} pts`, points: mvp.pts.total });
    await this.upsert('MATCH', key, 'BEST_BATSMAN', batsman && { playerId: batsman.playerId, teamId: batsman.teamId, value: bat(batsman) });
    await this.upsert('MATCH', key, 'BEST_BOWLER', bowler && { playerId: bowler.playerId, teamId: bowler.teamId, value: `${bowler.wickets}/${bowler.runsConceded}` });
    await this.upsert('MATCH', key, 'BEST_FIELDER', fielder && { playerId: fielder.playerId, teamId: fielder.teamId, value: `${fielder.catches}c ${fielder.runOuts}ro ${fielder.stumpings}st` });
    await this.upsert('MATCH', key, 'MOST_SIXES', sixes && { playerId: sixes.playerId, teamId: sixes.teamId, value: `${sixes.sixes} sixes` });
    await this.upsert('MATCH', key, 'MOST_FOURS', fours && { playerId: fours.playerId, teamId: fours.teamId, value: `${fours.fours} fours` });
    await this.upsert(
      'MATCH',
      key,
      'HIGHEST_PARTNERSHIP',
      partnership && partnership.runs > 0
        ? { playerId: partnership.batter1Id, secondPlayerId: partnership.batter2Id, teamId: partnership.innings.battingTeamId, value: `${partnership.runs} (${partnership.balls})` }
        : null,
    );

    const mvpAward = await this.prisma.award.findUnique({ where: { matchId_type: { matchId, type: 'MAN_OF_THE_MATCH' } } });
    await this.prisma.match.update({ where: { id: matchId }, data: { mvpPlayerId: mvpAward?.playerId ?? null } });
    return this.matchAwards(matchId);
  }

  /** Cumulative tournament awards from completed matches. */
  async computeTournamentAwards(tournamentId: string) {
    const where: Prisma.PlayerMatchStatsWhereInput = { match: { tournamentId, deletedAt: null, status: 'COMPLETED' } };
    const agg = await this.prisma.playerMatchStats.groupBy({
      by: ['playerId'],
      where,
      _sum: {
        runs: true, ballsFaced: true, fours: true, sixes: true, wickets: true, runsConceded: true, ballsBowled: true,
        catches: true, runOuts: true, stumpings: true, mvpPoints: true, battingPoints: true, bowlingPoints: true,
      },
    });
    const players = agg.map((a) => {
      const s = a._sum;
      return {
        playerId: a.playerId,
        runs: s.runs ?? 0,
        balls: s.ballsFaced ?? 0,
        fours: s.fours ?? 0,
        sixes: s.sixes ?? 0,
        wickets: s.wickets ?? 0,
        conceded: s.runsConceded ?? 0,
        bowled: s.ballsBowled ?? 0,
        dismissals: (s.catches ?? 0) + (s.runOuts ?? 0) + (s.stumpings ?? 0),
        mvp: Number(s.mvpPoints ?? 0),
        bat: Number(s.battingPoints ?? 0),
        bowl: Number(s.bowlingPoints ?? 0),
      };
    });
    const key = { tournamentId };
    const pos = <T>(xs: T[], f: (x: T) => number) => xs.filter((x) => f(x) > 0);

    const mot = best(players, (p) => p.mvp);
    const orange = best(pos(players, (p) => p.runs), (p) => p.runs, (p) => -p.balls);
    const purple = best(pos(players, (p) => p.wickets), (p) => p.wickets, (p) => -economy(p.conceded, p.bowled));
    const batsman = best(pos(players, (p) => p.bat), (p) => p.bat);
    const bowler = best(pos(players, (p) => p.bowl), (p) => p.bowl);
    const allRounders = players.filter((p) => p.runs > 0 && p.wickets > 0);
    const allRounder = best(allRounders.filter((p) => p.bat >= 15 && p.bowl >= 15).length ? allRounders.filter((p) => p.bat >= 15 && p.bowl >= 15) : allRounders, (p) => p.bat + p.bowl);
    const fielder = best(pos(players, (p) => p.dismissals), (p) => p.dismissals);
    const sixes = best(pos(players, (p) => p.sixes), (p) => p.sixes, (p) => p.runs);
    const fours = best(pos(players, (p) => p.fours), (p) => p.fours, (p) => p.runs);
    const srPool = players.filter((p) => p.balls >= 30).length ? players.filter((p) => p.balls >= 30) : players.filter((p) => p.balls >= 10);
    const sr = best(srPool, (p) => strikeRate(p.runs, p.balls));
    const ecoPool = players.filter((p) => p.bowled >= 24).length ? players.filter((p) => p.bowled >= 24) : players.filter((p) => p.bowled >= 6);
    const eco = best(ecoPool, (p) => -economy(p.conceded, p.bowled));

    const hs = await this.prisma.playerMatchStats.findFirst({ where: { ...where, batted: true }, orderBy: [{ runs: 'desc' }, { ballsFaced: 'asc' }] });
    const bbf = await this.prisma.playerMatchStats.findFirst({ where: { ...where, wickets: { gt: 0 } }, orderBy: [{ wickets: 'desc' }, { runsConceded: 'asc' }] });

    await this.upsert('TOURNAMENT', key, 'MAN_OF_THE_TOURNAMENT', mot && mot.mvp > 0 ? { playerId: mot.playerId, value: `${round2(mot.mvp)} pts`, points: mot.mvp } : null);
    await this.upsert('TOURNAMENT', key, 'ORANGE_CAP', orange && { playerId: orange.playerId, value: `${orange.runs} runs` });
    await this.upsert('TOURNAMENT', key, 'PURPLE_CAP', purple && { playerId: purple.playerId, value: `${purple.wickets} wickets` });
    await this.upsert('TOURNAMENT', key, 'BEST_BATSMAN', batsman && { playerId: batsman.playerId, value: `${batsman.runs} runs, SR ${strikeRate(batsman.runs, batsman.balls)}`, points: batsman.bat });
    await this.upsert('TOURNAMENT', key, 'BEST_BOWLER', bowler && { playerId: bowler.playerId, value: `${bowler.wickets} wkts, econ ${economy(bowler.conceded, bowler.bowled)}`, points: bowler.bowl });
    await this.upsert('TOURNAMENT', key, 'BEST_ALL_ROUNDER', allRounder && { playerId: allRounder.playerId, value: `${allRounder.runs} runs & ${allRounder.wickets} wkts`, points: allRounder.bat + allRounder.bowl });
    await this.upsert('TOURNAMENT', key, 'BEST_FIELDER', fielder && { playerId: fielder.playerId, value: `${fielder.dismissals} dismissals` });
    await this.upsert('TOURNAMENT', key, 'MOST_SIXES', sixes && { playerId: sixes.playerId, value: `${sixes.sixes} sixes` });
    await this.upsert('TOURNAMENT', key, 'MOST_FOURS', fours && { playerId: fours.playerId, value: `${fours.fours} fours` });
    await this.upsert('TOURNAMENT', key, 'BEST_STRIKE_RATE', sr && sr.runs > 0 ? { playerId: sr.playerId, value: `SR ${strikeRate(sr.runs, sr.balls)} (${sr.runs} off ${sr.balls})` } : null);
    await this.upsert('TOURNAMENT', key, 'BEST_ECONOMY', eco && { playerId: eco.playerId, value: `Econ ${economy(eco.conceded, eco.bowled)}` });
    await this.upsert('TOURNAMENT', key, 'HIGHEST_INDIVIDUAL_SCORE', hs && hs.runs > 0 ? { playerId: hs.playerId, teamId: hs.teamId, value: `${hs.runs}${hs.isOut ? '' : '*'} (${hs.ballsFaced})` } : null);
    await this.upsert('TOURNAMENT', key, 'BEST_BOWLING_FIGURES', bbf && { playerId: bbf.playerId, teamId: bbf.teamId, value: `${bbf.wickets}/${bbf.runsConceded}` });
    return this.tournamentAwards(tournamentId);
  }

  private readonly include = {
    player: { select: { id: true, name: true, photoUrl: true } },
    secondPlayer: { select: { id: true, name: true, photoUrl: true } },
    team: { select: { id: true, name: true, logoUrl: true } },
  } satisfies Prisma.AwardInclude;

  matchAwards(matchId: string) {
    return this.prisma.award.findMany({ where: { matchId }, include: this.include, orderBy: { type: 'asc' } });
  }

  tournamentAwards(tournamentId: string) {
    return this.prisma.award.findMany({ where: { tournamentId }, include: this.include, orderBy: { type: 'asc' } });
  }

  /** Organizer override for a match award (e.g. Man of the Match). Overridden awards are never recomputed. */
  async overrideMatchAward(user: AuthUser, matchId: string, type: AwardType, playerId: string, note?: string) {
    if (!MATCH_AWARD_TYPES.includes(type)) throw new BadRequestException(`${type} is not a match award`);
    await this.access.assertCanManageMatch(user, matchId);
    const match = await this.prisma.match.findFirst({ where: { id: matchId, deletedAt: null } });
    if (!match) throw new NotFoundException('Match not found');
    if (match.status !== 'COMPLETED') throw new BadRequestException('Awards can be overridden after the match is completed');
    const stat = await this.prisma.playerMatchStats.findUnique({ where: { matchId_playerId: { matchId, playerId } } });
    if (!stat) throw new BadRequestException('Player did not take part in this match');
    const before = await this.prisma.award.findUnique({ where: { matchId_type: { matchId, type } } });
    const award = await this.prisma.award.upsert({
      where: { matchId_type: { matchId, type } },
      update: { playerId, teamId: stat.teamId, isOverridden: true, overriddenById: user.id, note, value: before?.value ?? 'Organizer choice' },
      create: { scope: 'MATCH', type, matchId, playerId, teamId: stat.teamId, isOverridden: true, overriddenById: user.id, note, value: 'Organizer choice' },
    });
    if (type === 'MAN_OF_THE_MATCH') await this.prisma.match.update({ where: { id: matchId }, data: { mvpPlayerId: playerId } });
    await this.audit.log({ userId: user.id, matchId, entityType: 'AWARD', entityId: award.id, action: 'OVERRIDE', oldValue: before, newValue: { type, playerId }, reason: note });
    return award;
  }

  /** Removes an override so the award is computed automatically again. */
  async clearOverride(user: AuthUser, matchId: string, type: AwardType) {
    await this.access.assertCanManageMatch(user, matchId);
    await this.prisma.award.updateMany({ where: { matchId, type }, data: { isOverridden: false, overriddenById: null } });
    return this.computeMatchAwards(matchId);
  }
}
