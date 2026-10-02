import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { netRunRate } from '../../common/utils/cricket.util';
import { PrismaService } from '../../prisma/prisma.service';

interface Row {
  played: number;
  won: number;
  lost: number;
  tied: number;
  noResult: number;
  points: number;
  runsScored: number;
  ballsFaced: number;
  runsConceded: number;
  ballsBowled: number;
}

export const POINTS = { WIN: 2, TIE: 1, NO_RESULT: 1 } as const;

/**
 * Points table: 2 for a win, 1 for a tie / no result.
 * NRR uses main innings only; a side bowled out is charged its full quota of overs.
 */
@Injectable()
export class PointsTableService {
  constructor(private readonly prisma: PrismaService) {}

  async recalculate(tournamentId: string) {
    const [entries, matches] = await Promise.all([
      this.prisma.tournamentTeam.findMany({ where: { tournamentId } }),
      this.prisma.match.findMany({
        where: { tournamentId, deletedAt: null, status: 'COMPLETED', stage: 'LEAGUE' },
        include: { innings: { where: { isSuperOver: false } } },
      }),
    ]);
    const rows = new Map<string, Row>(
      entries.map((e) => [e.teamId, { played: 0, won: 0, lost: 0, tied: 0, noResult: 0, points: 0, runsScored: 0, ballsFaced: 0, runsConceded: 0, ballsBowled: 0 }]),
    );

    for (const m of matches) {
      const a = rows.get(m.teamAId);
      const b = rows.get(m.teamBId);
      if (!a || !b) continue;
      a.played++;
      b.played++;
      if (m.resultType === 'WIN' && m.winnerTeamId) {
        const [w, l] = m.winnerTeamId === m.teamAId ? [a, b] : [b, a];
        w.won++;
        w.points += POINTS.WIN;
        l.lost++;
      } else if (m.resultType === 'TIE') {
        a.tied++;
        b.tied++;
        a.points += POINTS.TIE;
        b.points += POINTS.TIE;
      } else {
        a.noResult++;
        b.noResult++;
        a.points += POINTS.NO_RESULT;
        b.points += POINTS.NO_RESULT;
        continue; // no-result matches are excluded from NRR
      }
      for (const inn of m.innings) {
        const bat = rows.get(inn.battingTeamId);
        const bowl = rows.get(inn.bowlingTeamId);
        if (!bat || !bowl) continue;
        const balls = inn.isAllOut ? inn.maxOvers * m.ballsPerOver : inn.legalBalls;
        bat.runsScored += inn.runs;
        bat.ballsFaced += balls;
        bowl.runsConceded += inn.runs;
        bowl.ballsBowled += balls;
      }
    }

    await this.prisma.$transaction(
      [...rows.entries()].map(([teamId, r]) =>
        this.prisma.tournamentTeam.update({
          where: { tournamentId_teamId: { tournamentId, teamId } },
          data: { ...r, netRunRate: new Prisma.Decimal(netRunRate(r.runsScored, r.ballsFaced, r.runsConceded, r.ballsBowled)) },
        }),
      ),
    );
    return this.table(tournamentId);
  }

  async table(tournamentId: string) {
    const rows = await this.prisma.tournamentTeam.findMany({
      where: { tournamentId, team: { deletedAt: null } },
      include: { team: { select: { id: true, name: true, shortName: true, logoUrl: true, color: true } } },
      orderBy: [{ points: 'desc' }, { netRunRate: 'desc' }, { won: 'desc' }, { createdAt: 'asc' }],
    });
    return rows.map((r, i) => ({
      position: i + 1,
      groupName: r.groupName,
      team: r.team,
      played: r.played,
      won: r.won,
      lost: r.lost,
      tied: r.tied,
      noResult: r.noResult,
      points: r.points,
      netRunRate: Number(r.netRunRate),
      runsFor: `${r.runsScored}/${Math.floor(r.ballsFaced / 6)}.${r.ballsFaced % 6}`,
      runsAgainst: `${r.runsConceded}/${Math.floor(r.ballsBowled / 6)}.${r.ballsBowled % 6}`,
      isEliminated: r.isEliminated,
    }));
  }
}
