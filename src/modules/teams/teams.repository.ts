import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export const PLAYER_BRIEF = {
  id: true,
  name: true,
  photoUrl: true,
  jerseyNumber: true,
  role: true,
  battingStyle: true,
  bowlingStyle: true,
  isTemporary: true,
  tempCode: true,
  userId: true,
} satisfies Prisma.PlayerSelect;

export const TEAM_DETAIL = {
  captain: { select: PLAYER_BRIEF },
  wicketKeeper: { select: PLAYER_BRIEF },
  manager: { select: { id: true, name: true, photoUrl: true } },
  createdBy: { select: { id: true, name: true } },
  stats: true,
  _count: { select: { players: { where: { status: 'ACTIVE' } } } },
} satisfies Prisma.TeamInclude;

@Injectable()
export class TeamsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string) {
    return this.prisma.team.findFirst({ where: { id, deletedAt: null }, include: TEAM_DETAIL });
  }

  findByCode(code: string) {
    return this.prisma.team.findFirst({ where: { deletedAt: null, OR: [{ joinCode: code.toUpperCase() }, { qrToken: code }] } });
  }

  search(where: Prisma.TeamWhereInput, skip: number, take: number, orderBy: Prisma.TeamOrderByWithRelationInput) {
    return this.prisma.$transaction([
      this.prisma.team.findMany({ where, skip, take, orderBy, include: TEAM_DETAIL }),
      this.prisma.team.count({ where }),
    ]);
  }

  squad(teamId: string) {
    return this.prisma.teamPlayer.findMany({
      where: { teamId, status: 'ACTIVE', player: { deletedAt: null } },
      include: { player: { select: { ...PLAYER_BRIEF, careerStats: { select: { matches: true, runs: true, wickets: true } } } } },
      orderBy: { joinedAt: 'asc' },
    });
  }

  isMember(teamId: string, playerId: string) {
    return this.prisma.teamPlayer.findFirst({ where: { teamId, playerId, status: 'ACTIVE' } });
  }

  addMember(teamId: string, playerId: string, tx: Prisma.TransactionClient = this.prisma) {
    return tx.teamPlayer.upsert({
      where: { teamId_playerId: { teamId, playerId } },
      update: { status: 'ACTIVE', removedAt: null, joinedAt: new Date() },
      create: { teamId, playerId },
    });
  }
}
