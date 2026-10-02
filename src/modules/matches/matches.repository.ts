import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

const TEAM_BRIEF = { select: { id: true, name: true, shortName: true, logoUrl: true, color: true, isTemporary: true } } as const;

export const MATCH_LIST_INCLUDE = {
  teamA: TEAM_BRIEF,
  teamB: TEAM_BRIEF,
  tournament: { select: { id: true, name: true, logoUrl: true } },
  innings: {
    orderBy: { number: 'asc' },
    select: { id: true, number: true, isSuperOver: true, battingTeamId: true, runs: true, wickets: true, legalBalls: true, completedOvers: true, ballsInOver: true, target: true, status: true },
  },
} satisfies Prisma.MatchInclude;

export const MATCH_DETAIL_INCLUDE = {
  ...MATCH_LIST_INCLUDE,
  tossWinner: TEAM_BRIEF,
  winner: TEAM_BRIEF,
  createdBy: { select: { id: true, name: true } },
  scorerLock: { select: { userId: true, acquiredAt: true, user: { select: { id: true, name: true, photoUrl: true } } } },
  players: {
    orderBy: [{ teamId: 'asc' }, { battingOrder: 'asc' }],
    include: { player: { select: { id: true, name: true, photoUrl: true, jerseyNumber: true, role: true, isTemporary: true, tempCode: true, userId: true } } },
  },
} satisfies Prisma.MatchInclude;

@Injectable()
export class MatchesRepository {
  constructor(private readonly prisma: PrismaService) {}

  findDetail(id: string) {
    return this.prisma.match.findFirst({ where: { id, deletedAt: null }, include: MATCH_DETAIL_INCLUDE });
  }

  findActive(id: string) {
    return this.prisma.match.findFirst({ where: { id, deletedAt: null } });
  }

  search(where: Prisma.MatchWhereInput, skip: number, take: number, orderBy: Prisma.MatchOrderByWithRelationInput[]) {
    return this.prisma.$transaction([
      this.prisma.match.findMany({ where, skip, take, orderBy, include: MATCH_LIST_INCLUDE }),
      this.prisma.match.count({ where }),
    ]);
  }

  event(matchId: string, type: Prisma.ScoreEventCreateManyInput['type'], userId: string | null, payload?: unknown, inningsNo?: number, ballId?: string, tx: Prisma.TransactionClient = this.prisma) {
    return tx.scoreEvent.create({
      data: { matchId, type, userId, inningsNo, ballId, payload: payload === undefined ? Prisma.DbNull : (JSON.parse(JSON.stringify(payload)) as Prisma.InputJsonValue) },
    });
  }
}
