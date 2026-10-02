import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../prisma/prisma.service';

export const TOURNAMENT_INCLUDE = {
  organizer: { select: { id: true, name: true, photoUrl: true } },
  _count: { select: { teams: true, matches: { where: { deletedAt: null } } } },
} satisfies Prisma.TournamentInclude;

@Injectable()
export class TournamentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  findById(id: string) {
    return this.prisma.tournament.findFirst({ where: { id, deletedAt: null }, include: TOURNAMENT_INCLUDE });
  }

  search(where: Prisma.TournamentWhereInput, skip: number, take: number, orderBy: Prisma.TournamentOrderByWithRelationInput) {
    return this.prisma.$transaction([
      this.prisma.tournament.findMany({ where, skip, take, orderBy, include: TOURNAMENT_INCLUDE }),
      this.prisma.tournament.count({ where }),
    ]);
  }

  teams(tournamentId: string) {
    return this.prisma.tournamentTeam.findMany({
      where: { tournamentId, team: { deletedAt: null } },
      orderBy: [{ seed: 'asc' }, { createdAt: 'asc' }],
      include: {
        team: {
          select: {
            id: true,
            name: true,
            shortName: true,
            logoUrl: true,
            color: true,
            captain: { select: { id: true, name: true } },
            _count: { select: { players: { where: { status: 'ACTIVE' } } } },
          },
        },
      },
    });
  }
}
