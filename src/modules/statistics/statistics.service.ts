import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { paginate, pageArgs, PaginationQueryDto } from '../../common/dto/pagination.dto';
import { average, economy, oversText, round2, strikeRate } from '../../common/utils/cricket.util';
import { PrismaService } from '../../prisma/prisma.service';

export const LEADERBOARD_CATEGORIES = ['runs', 'wickets', 'sixes', 'fours', 'strikeRate', 'economy', 'catches', 'dismissals', 'mvp'] as const;
export type LeaderboardCategory = (typeof LEADERBOARD_CATEGORIES)[number];

export interface StatsScope {
  tournamentId?: string;
  season?: string;
  ground?: string;
  teamId?: string;
}

const COMPLETED: Prisma.MatchWhereInput = { deletedAt: null, status: 'COMPLETED' };

@Injectable()
export class StatisticsService {
  constructor(private readonly prisma: PrismaService) {}

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ writers (called by the post-match pipeline) â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  /** Recomputes permanent career statistics from all completed matches. */
  async refreshCareers(playerIds: string[]) {
    for (const playerId of [...new Set(playerIds)]) {
      const player = await this.prisma.player.findUnique({ where: { id: playerId }, select: { deletedAt: true } });
      if (!player || player.deletedAt) continue;
      const rows = await this.prisma.playerMatchStats.findMany({ where: { playerId, match: COMPLETED } });
      const batted = rows.filter((r) => r.batted);
      const bowled = rows.filter((r) => r.bowled);
      const sum = (xs: typeof rows, f: (r: (typeof rows)[number]) => number) => xs.reduce((s, r) => s + f(r), 0);
      const runs = sum(batted, (r) => r.runs);
      const balls = sum(batted, (r) => r.ballsFaced);
      const outs = batted.filter((r) => r.isOut).length;
      const high = batted.reduce<(typeof rows)[number] | null>((b, r) => (!b || r.runs > b.runs || (r.runs === b.runs && !r.isOut && b.isOut) ? r : b), null);
      const ballsBowled = sum(bowled, (r) => r.ballsBowled);
      const conceded = sum(bowled, (r) => r.runsConceded);
      const wickets = sum(bowled, (r) => r.wickets);
      const bestBowl = bowled.reduce<(typeof rows)[number] | null>((b, r) => (!b || r.wickets > b.wickets || (r.wickets === b.wickets && r.runsConceded < b.runsConceded) ? r : b), null);

      const data = {
        matches: rows.length,
        battingInnings: batted.length,
        notOuts: batted.length - outs,
        runs,
        ballsFaced: balls,
        highestScore: high?.runs ?? 0,
        highestScoreNotOut: high ? !high.isOut : false,
        battingAverage: average(runs, outs),
        strikeRate: strikeRate(runs, balls),
        fifties: batted.filter((r) => r.runs >= 50 && r.runs < 100).length,
        hundreds: batted.filter((r) => r.runs >= 100).length,
        ducks: batted.filter((r) => r.isOut && r.runs === 0).length,
        fours: sum(batted, (r) => r.fours),
        sixes: sum(batted, (r) => r.sixes),
        bowlingInnings: bowled.length,
        ballsBowled,
        overs: oversText(ballsBowled),
        runsConceded: conceded,
        wickets,
        economy: economy(conceded, ballsBowled),
        bowlingAverage: average(conceded, wickets),
        maidens: sum(bowled, (r) => r.maidens),
        bestBowlingWickets: bestBowl?.wickets ?? 0,
        bestBowlingRuns: bestBowl?.runsConceded ?? 0,
        catches: sum(rows, (r) => r.catches),
        runOuts: sum(rows, (r) => r.runOuts),
        stumpings: sum(rows, (r) => r.stumpings),
      };
      await this.prisma.playerCareerStats.upsert({ where: { playerId }, update: data, create: { playerId, ...data } });
    }
  }

  async refreshTeams(teamIds: string[]) {
    for (const teamId of [...new Set(teamIds)]) {
      const matches = await this.prisma.match.findMany({ where: { ...COMPLETED, OR: [{ teamAId: teamId }, { teamBId: teamId }] }, select: { resultType: true, winnerTeamId: true } });
      const totals = await this.prisma.innings.findMany({
        where: { battingTeamId: teamId, isSuperOver: false, status: 'COMPLETED', match: COMPLETED },
        select: { runs: true, wickets: true },
      });
      const won = matches.filter((m) => m.resultType === 'WIN' && m.winnerTeamId === teamId).length;
      const lost = matches.filter((m) => m.resultType === 'WIN' && m.winnerTeamId !== teamId).length;
      const data = {
        matches: matches.length,
        won,
        lost,
        tied: matches.filter((m) => m.resultType === 'TIE').length,
        noResult: matches.filter((m) => m.resultType === 'NO_RESULT' || m.resultType === 'ABANDONED').length,
        winPercentage: matches.length ? round2((won / matches.length) * 100) : 0,
        highestTotal: totals.reduce((mx, t) => Math.max(mx, t.runs), 0),
        lowestTotal: totals.length ? Math.min(...totals.map((t) => t.runs)) : null,
        totalRuns: totals.reduce((s, t) => s + t.runs, 0),
        totalWickets: totals.reduce((s, t) => s + t.wickets, 0),
      };
      await this.prisma.teamStats.upsert({ where: { teamId }, update: data, create: { teamId, ...data } });
    }
  }

  async refreshTournament(tournamentId: string) {
    const where: Prisma.MatchWhereInput = { ...COMPLETED, tournamentId };
    const [matchesPlayed, innings, agg] = await Promise.all([
      this.prisma.match.count({ where }),
      this.prisma.innings.findMany({ where: { match: where, isSuperOver: false }, select: { runs: true, wickets: true, battingTeamId: true, status: true } }),
      this.prisma.playerMatchStats.aggregate({ where: { match: where }, _sum: { fours: true, sixes: true } }),
    ]);
    const top = innings.reduce<(typeof innings)[number] | null>((b, i) => (!b || i.runs > b.runs ? i : b), null);
    const completedInnings = innings.filter((i) => i.status === 'COMPLETED');
    const leaderboards = {
      runs: await this.leaderboard('runs', { tournamentId }, 10),
      wickets: await this.leaderboard('wickets', { tournamentId }, 10),
      sixes: await this.leaderboard('sixes', { tournamentId }, 5),
      strikeRate: await this.leaderboard('strikeRate', { tournamentId }, 5),
      economy: await this.leaderboard('economy', { tournamentId }, 5),
      mvp: await this.leaderboard('mvp', { tournamentId }, 5),
    };
    const data = {
      matchesPlayed,
      totalRuns: innings.reduce((s, i) => s + i.runs, 0),
      totalWickets: innings.reduce((s, i) => s + i.wickets, 0),
      totalFours: agg._sum.fours ?? 0,
      totalSixes: agg._sum.sixes ?? 0,
      highestTotal: top?.runs ?? 0,
      highestTotalTeamId: top?.battingTeamId ?? null,
      lowestTotal: completedInnings.length ? Math.min(...completedInnings.map((i) => i.runs)) : null,
      leaderboards: JSON.parse(JSON.stringify(leaderboards)),
    };
    await this.prisma.tournamentStats.upsert({ where: { tournamentId }, update: data, create: { tournamentId, ...data } });
  }

  // â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€ readers â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

  private scopeWhere(scope: StatsScope): Prisma.PlayerMatchStatsWhereInput {
    return {
      teamId: scope.teamId,
      match: {
        ...COMPLETED,
        tournamentId: scope.tournamentId,
        ground: scope.ground ? { contains: scope.ground } : undefined,
        tournament: scope.season ? { season: scope.season } : undefined,
      },
    };
  }

  /** Top players for a category within an optional scope (tournament / season / ground / team). */
  async leaderboard(category: LeaderboardCategory, scope: StatsScope, limit = 10) {
    if (!LEADERBOARD_CATEGORIES.includes(category)) throw new BadRequestException(`category must be one of ${LEADERBOARD_CATEGORIES.join(', ')}`);
    const groups = await this.prisma.playerMatchStats.groupBy({
      by: ['playerId'],
      where: this.scopeWhere(scope),
      _count: { matchId: true },
      _sum: { runs: true, ballsFaced: true, fours: true, sixes: true, wickets: true, runsConceded: true, ballsBowled: true, catches: true, runOuts: true, stumpings: true, mvpPoints: true },
    });
    const rows = groups.map((g) => {
      const s = g._sum;
      const runs = s.runs ?? 0;
      const balls = s.ballsFaced ?? 0;
      const bowled = s.ballsBowled ?? 0;
      const conceded = s.runsConceded ?? 0;
      return {
        playerId: g.playerId,
        matches: g._count.matchId,
        runs,
        balls,
        fours: s.fours ?? 0,
        sixes: s.sixes ?? 0,
        wickets: s.wickets ?? 0,
        overs: oversText(bowled),
        strikeRate: strikeRate(runs, balls),
        economy: economy(conceded, bowled),
        ballsBowled: bowled,
        catches: s.catches ?? 0,
        dismissals: (s.catches ?? 0) + (s.runOuts ?? 0) + (s.stumpings ?? 0),
        mvp: round2(Number(s.mvpPoints ?? 0)),
      };
    });
    const minBalls = scope.tournamentId ? 30 : 60;
    const sorters: Record<LeaderboardCategory, { filter: (r: (typeof rows)[number]) => boolean; value: (r: (typeof rows)[number]) => number; asc?: boolean }> = {
      runs: { filter: (r) => r.runs > 0, value: (r) => r.runs },
      wickets: { filter: (r) => r.wickets > 0, value: (r) => r.wickets },
      sixes: { filter: (r) => r.sixes > 0, value: (r) => r.sixes },
      fours: { filter: (r) => r.fours > 0, value: (r) => r.fours },
      strikeRate: { filter: (r) => r.balls >= minBalls, value: (r) => r.strikeRate },
      economy: { filter: (r) => r.ballsBowled >= minBalls / 2, value: (r) => r.economy, asc: true },
      catches: { filter: (r) => r.catches > 0, value: (r) => r.catches },
      dismissals: { filter: (r) => r.dismissals > 0, value: (r) => r.dismissals },
      mvp: { filter: (r) => r.mvp > 0, value: (r) => r.mvp },
    };
    const s = sorters[category];
    const top = rows
      .filter(s.filter)
      .sort((a, b) => (s.asc ? s.value(a) - s.value(b) : s.value(b) - s.value(a)))
      .slice(0, limit);
    const players = await this.prisma.player.findMany({ where: { id: { in: top.map((t) => t.playerId) } }, select: { id: true, name: true, photoUrl: true } });
    const byId = new Map(players.map((p) => [p.id, p]));
    return top.map((t, i) => ({ rank: i + 1, player: byId.get(t.playerId), value: s.value(t), ...t }));
  }

  async player(playerId: string) {
    const player = await this.prisma.player.findFirst({ where: { id: playerId, deletedAt: null }, include: { careerStats: true } });
    if (!player) throw new NotFoundException('Player not found');
    const recent = await this.prisma.playerMatchStats.findMany({
      where: { playerId, match: COMPLETED },
      orderBy: { match: { completedAt: 'desc' } },
      take: 10,
      include: { match: { select: { id: true, name: true, completedAt: true, teamA: { select: { name: true } }, teamB: { select: { name: true } }, resultText: true } } },
    });
    const tournamentMatches = await this.prisma.playerMatchStats.count({ where: { playerId, match: { ...COMPLETED, tournamentId: { not: null } } } });
    return {
      player: { id: player.id, name: player.name, photoUrl: player.photoUrl, role: player.role, battingStyle: player.battingStyle, bowlingStyle: player.bowlingStyle },
      career: player.careerStats,
      recentForm: recent.map((r) => ({
        match: r.match,
        batting: r.batted ? `${r.runs}${r.isOut ? '' : '*'} (${r.ballsFaced})` : null,
        bowling: r.bowled ? `${r.wickets}/${r.runsConceded} (${oversText(r.ballsBowled)})` : null,
        mvpPoints: Number(r.mvpPoints),
      })),
      tournamentMatches,
    };
  }

  async playerMatches(playerId: string, q: PaginationQueryDto) {
    const where = { playerId, match: COMPLETED };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.playerMatchStats.findMany({
        where,
        ...pageArgs(q),
        orderBy: { match: { completedAt: q.sortOrder } },
        include: { match: { select: { id: true, name: true, completedAt: true, ground: true, resultText: true, teamA: { select: { id: true, name: true } }, teamB: { select: { id: true, name: true } } } } },
      }),
      this.prisma.playerMatchStats.count({ where }),
    ]);
    return paginate(items, total, q);
  }

  async team(teamId: string) {
    const team = await this.prisma.team.findFirst({ where: { id: teamId, deletedAt: null }, include: { stats: true } });
    if (!team) throw new NotFoundException('Team not found');
    const recent = await this.prisma.match.findMany({
      where: { ...COMPLETED, OR: [{ teamAId: teamId }, { teamBId: teamId }] },
      orderBy: { completedAt: 'desc' },
      take: 5,
      select: { id: true, name: true, resultText: true, winnerTeamId: true, resultType: true, completedAt: true },
    });
    return {
      team: { id: team.id, name: team.name, logoUrl: team.logoUrl },
      stats: team.stats,
      form: recent.map((m) => (m.resultType === 'WIN' ? (m.winnerTeamId === teamId ? 'W' : 'L') : m.resultType === 'TIE' ? 'T' : 'NR')),
      recentMatches: recent,
      topBatters: await this.leaderboard('runs', { teamId }, 5),
      topBowlers: await this.leaderboard('wickets', { teamId }, 5),
    };
  }

  async tournament(tournamentId: string) {
    const t = await this.prisma.tournament.findFirst({ where: { id: tournamentId, deletedAt: null }, include: { stats: true } });
    if (!t) throw new NotFoundException('Tournament not found');
    if (!t.stats) await this.refreshTournament(tournamentId);
    return this.prisma.tournamentStats.findUnique({ where: { tournamentId } });
  }

  async season(season: string) {
    const tournaments = await this.prisma.tournament.findMany({ where: { season, deletedAt: null }, select: { id: true, name: true, status: true } });
    const scope = { season };
    const matches = await this.prisma.match.count({ where: { ...COMPLETED, tournament: { season } } });
    return {
      season,
      tournaments,
      matches,
      leaders: {
        runs: await this.leaderboard('runs', scope, 10),
        wickets: await this.leaderboard('wickets', scope, 10),
        sixes: await this.leaderboard('sixes', scope, 5),
        mvp: await this.leaderboard('mvp', scope, 5),
      },
    };
  }

  async ground(ground: string) {
    const where: Prisma.MatchWhereInput = { ...COMPLETED, ground: { contains: ground } };
    const matches = await this.prisma.match.findMany({
      where,
      select: { id: true, winnerTeamId: true, resultType: true, innings: { where: { isSuperOver: false }, orderBy: { number: 'asc' }, select: { number: true, runs: true, battingTeamId: true, wickets: true } } },
    });
    const first = matches.map((m) => m.innings.find((i) => i.number === 1)).filter(Boolean) as { runs: number; battingTeamId: string }[];
    const second = matches.map((m) => m.innings.find((i) => i.number === 2)).filter(Boolean) as { runs: number }[];
    const decided = matches.filter((m) => m.resultType === 'WIN');
    const batFirstWins = decided.filter((m) => m.innings.find((i) => i.number === 1)?.battingTeamId === m.winnerTeamId).length;
    const all = matches.flatMap((m) => m.innings);
    return {
      ground,
      matches: matches.length,
      averageFirstInnings: first.length ? Math.round(first.reduce((s, i) => s + i.runs, 0) / first.length) : 0,
      averageSecondInnings: second.length ? Math.round(second.reduce((s, i) => s + i.runs, 0) / second.length) : 0,
      highestTotal: all.reduce((m, i) => Math.max(m, i.runs), 0),
      lowestTotal: all.length ? Math.min(...all.map((i) => i.runs)) : 0,
      battingFirstWinPercentage: decided.length ? round2((batFirstWins / decided.length) * 100) : 0,
      topBatters: await this.leaderboard('runs', { ground }, 5),
      topBowlers: await this.leaderboard('wickets', { ground }, 5),
    };
  }

  async headToHead(teamAId: string, teamBId: string) {
    const teams = await this.prisma.team.findMany({ where: { id: { in: [teamAId, teamBId] } }, select: { id: true, name: true, logoUrl: true } });
    if (teams.length !== 2) throw new NotFoundException('Team not found');
    const matches = await this.prisma.match.findMany({
      where: { ...COMPLETED, OR: [{ teamAId, teamBId }, { teamAId: teamBId, teamBId: teamAId }] },
      orderBy: { completedAt: 'desc' },
      select: { id: true, name: true, completedAt: true, resultType: true, winnerTeamId: true, resultText: true, ground: true, innings: { where: { isSuperOver: false }, select: { battingTeamId: true, runs: true, wickets: true } } },
    });
    const highest = (id: string) => matches.flatMap((m) => m.innings).filter((i) => i.battingTeamId === id).reduce((mx, i) => Math.max(mx, i.runs), 0);
    return {
      teams,
      played: matches.length,
      wins: { [teamAId]: matches.filter((m) => m.winnerTeamId === teamAId).length, [teamBId]: matches.filter((m) => m.winnerTeamId === teamBId).length },
      tied: matches.filter((m) => m.resultType === 'TIE').length,
      noResult: matches.filter((m) => m.resultType === 'NO_RESULT' || m.resultType === 'ABANDONED').length,
      highestTotals: { [teamAId]: highest(teamAId), [teamBId]: highest(teamBId) },
      recent: matches.slice(0, 5),
    };
  }
}
