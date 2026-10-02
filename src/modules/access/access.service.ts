import { ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { AuthUser } from '../../common/interfaces/auth-user.interface';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * Resource-level authorization (ownership rules) on top of the role/permission guard.
 *
 * - Tournament: organizer of the tournament.
 * - Team: creator, manager, captain's user, or organizer of a tournament containing the team.
 * - Match: creator, organizer of its tournament, or a manager of either team (for non-tournament matches).
 */
@Injectable()
export class AccessService {
  constructor(private readonly prisma: PrismaService) {}

  isSuperAdmin(user: AuthUser) {
    return user.roles.includes(RoleName.SUPER_ADMIN);
  }

  async canManageTournament(user: AuthUser, tournamentId: string) {
    if (this.isSuperAdmin(user)) return true;
    const t = await this.prisma.tournament.findFirst({ where: { id: tournamentId, deletedAt: null }, select: { organizerId: true } });
    if (!t) throw new NotFoundException('Tournament not found');
    return t.organizerId === user.id;
  }

  async assertCanManageTournament(user: AuthUser, tournamentId: string) {
    if (!(await this.canManageTournament(user, tournamentId))) throw new ForbiddenException('Only the tournament organizer can do this');
  }

  async canManageTeam(user: AuthUser, teamId: string) {
    if (this.isSuperAdmin(user)) return true;
    const team = await this.prisma.team.findFirst({
      where: { id: teamId, deletedAt: null },
      select: {
        createdById: true,
        managerId: true,
        captain: { select: { userId: true } },
        tournaments: { select: { tournament: { select: { organizerId: true } } } },
      },
    });
    if (!team) throw new NotFoundException('Team not found');
    return (
      team.createdById === user.id ||
      team.managerId === user.id ||
      (!!team.captain?.userId && team.captain.userId === user.id) ||
      team.tournaments.some((tt) => tt.tournament.organizerId === user.id)
    );
  }

  async assertCanManageTeam(user: AuthUser, teamId: string) {
    if (!(await this.canManageTeam(user, teamId))) throw new ForbiddenException('You cannot manage this team');
  }

  async canManageMatch(user: AuthUser, matchId: string) {
    if (this.isSuperAdmin(user)) return true;
    const m = await this.prisma.match.findFirst({
      where: { id: matchId, deletedAt: null },
      select: { createdById: true, teamAId: true, teamBId: true, tournament: { select: { organizerId: true } } },
    });
    if (!m) throw new NotFoundException('Match not found');
    if (m.createdById === user.id) return true;
    if (m.tournament) return m.tournament.organizerId === user.id;
    return false;
  }

  async assertCanManageMatch(user: AuthUser, matchId: string) {
    if (!(await this.canManageMatch(user, matchId))) throw new ForbiddenException('Only the match organizer can do this');
  }

  /** Players (linked users) of either team, plus managers. Used for gallery uploads etc. */
  async isMatchParticipant(user: AuthUser, matchId: string) {
    if (await this.canManageMatch(user, matchId)) return true;
    const m = await this.prisma.match.findUnique({ where: { id: matchId }, select: { teamAId: true, teamBId: true, scorerLock: true } });
    if (!m) return false;
    if (m.scorerLock?.userId === user.id) return true;
    if (!user.playerId) {
      return (await this.canManageTeam(user, m.teamAId)) || (await this.canManageTeam(user, m.teamBId));
    }
    const member = await this.prisma.teamPlayer.findFirst({
      where: { playerId: user.playerId, teamId: { in: [m.teamAId, m.teamBId] }, status: 'ACTIVE' },
    });
    return !!member || (await this.canManageTeam(user, m.teamAId)) || (await this.canManageTeam(user, m.teamBId));
  }
}
