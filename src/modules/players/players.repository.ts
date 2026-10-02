import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

@Injectable()
export class PlayersRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string) {
    return this.prisma.player.findFirst({
      where: { id, deletedAt: null },
      include: {
        careerStats: true,
        user: { select: { id: true, city: true } },
        teams: { where: { status: 'ACTIVE', team: { deletedAt: null } }, include: { team: { select: { id: true, name: true, logoUrl: true, color: true } } } },
        awards: { take: 10, orderBy: { createdAt: 'desc' }, select: { id: true, type: true, scope: true, matchId: true, tournamentId: true, value: true, createdAt: true } },
      },
    });
  }

  search(where: Prisma.PlayerWhereInput, skip: number, take: number, orderBy: Prisma.PlayerOrderByWithRelationInput) {
    return this.prisma.$transaction([
      this.prisma.player.findMany({
        where,
        skip,
        take,
        orderBy,
        include: { careerStats: { select: { matches: true, runs: true, wickets: true, strikeRate: true, economy: true } } },
      }),
      this.prisma.player.count({ where }),
    ]);
  }

  /** Re-points every reference from one player to another (used when merging a claimed temporary player). */
  async reassignReferences(tx: Prisma.TransactionClient, from: string, to: string) {
    const ballFields = ['batsmanId', 'nonStrikerId', 'bowlerId', 'dismissedPlayerId', 'fielderId'] as const;
    for (const f of ballFields) await tx.ball.updateMany({ where: { [f]: from }, data: { [f]: to } });
    const inningsFields = ['strikerId', 'nonStrikerId', 'bowlerId', 'previousBowlerId'] as const;
    for (const f of inningsFields) await tx.innings.updateMany({ where: { [f]: from }, data: { [f]: to } });
    await tx.playerMatchStats.updateMany({ where: { playerId: from }, data: { playerId: to } });
    await tx.playerMatchStats.updateMany({ where: { dismissedById: from }, data: { dismissedById: to } });
    await tx.playerMatchStats.updateMany({ where: { fielderId: from }, data: { fielderId: to } });
    await tx.matchPlayer.updateMany({ where: { playerId: from }, data: { playerId: to } });
    await tx.partnership.updateMany({ where: { batter1Id: from }, data: { batter1Id: to } });
    await tx.partnership.updateMany({ where: { batter2Id: from }, data: { batter2Id: to } });
    await tx.team.updateMany({ where: { captainId: from }, data: { captainId: to } });
    await tx.team.updateMany({ where: { wicketKeeperId: from }, data: { wicketKeeperId: to } });
    await tx.award.updateMany({ where: { playerId: from }, data: { playerId: to } });
    await tx.award.updateMany({ where: { secondPlayerId: from }, data: { secondPlayerId: to } });
    await tx.match.updateMany({ where: { mvpPlayerId: from }, data: { mvpPlayerId: to } });

    const memberships = await tx.teamPlayer.findMany({ where: { playerId: from } });
    for (const m of memberships) {
      const existing = await tx.teamPlayer.findUnique({ where: { teamId_playerId: { teamId: m.teamId, playerId: to } } });
      if (existing) await tx.teamPlayer.delete({ where: { id: m.id } });
      else await tx.teamPlayer.update({ where: { id: m.id }, data: { playerId: to } });
    }
  }
}
