import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { EventEmitter2 } from '@nestjs/event-emitter';
import { NotificationType, Prisma } from '@prisma/client';
import { DomainEvent, PlayersMergedEvent } from '../../common/constants/domain-events';
import { orderBy, pageArgs, paginate } from '../../common/dto/pagination.dto';
import { AuthUser } from '../../common/interfaces/auth-user.interface';
import { PrismaService } from '../../prisma/prisma.service';
import { AccessService } from '../access/access.service';
import { AuditService } from '../audit/audit.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ClaimQueryDto, CreateClaimDto, PlayerQueryDto, UpdatePlayerDto } from './dto/players.dto';
import { PlayersRepository } from './players.repository';

@Injectable()
export class PlayersService {
  constructor(
    private readonly repo: PlayersRepository,
    private readonly prisma: PrismaService,
    private readonly access: AccessService,
    private readonly audit: AuditService,
    private readonly notifications: NotificationsService,
    private readonly events: EventEmitter2,
  ) {}

  /** Returns the user's permanent player profile, creating it on first use. */
  async ensureForUser(userId: string, tx: Prisma.TransactionClient = this.prisma) {
    const existing = await tx.player.findUnique({ where: { userId } });
    if (existing) return existing;
    const user = await tx.user.findUniqueOrThrow({ where: { id: userId } });
    return tx.player.create({ data: { userId, name: user.name, photoUrl: user.photoUrl, createdById: userId } });
  }

  createTemporary(name: string, createdById: string, tempCode?: string, tx: Prisma.TransactionClient = this.prisma) {
    return tx.player.create({ data: { name, tempCode, isTemporary: true, createdById } });
  }

  async list(q: PlayerQueryDto) {
    const where: Prisma.PlayerWhereInput = {
      deletedAt: null,
      isTemporary: q.temporary,
      role: q.role,
      name: q.search ? { contains: q.search } : undefined,
      teams: q.teamId ? { some: { teamId: q.teamId, status: 'ACTIVE' } } : undefined,
      matchPlayers: q.matchId ? { some: { matchId: q.matchId } } : undefined,
    };
    const { skip, take } = pageArgs(q);
    const [items, total] = await this.repo.search(where, skip, take, orderBy(q, ['name', 'createdAt', 'jerseyNumber'], 'name'));
    return paginate(items, total, q);
  }

  /** Returns the player profile; ids of merged (claimed) temporary players resolve to the permanent profile. */
  async get(id: string) {
    let player = await this.repo.findById(id);
    if (!player) {
      const merged = await this.prisma.player.findUnique({ where: { id }, select: { mergedIntoId: true } });
      if (merged?.mergedIntoId) player = await this.repo.findById(merged.mergedIntoId);
    }
    if (!player) throw new NotFoundException('Player not found');
    return player;
  }

  async me(userId: string) {
    const p = await this.ensureForUser(userId);
    return this.get(p.id);
  }

  async updateMe(userId: string, dto: UpdatePlayerDto) {
    const p = await this.ensureForUser(userId);
    return this.prisma.player.update({ where: { id: p.id }, data: dto });
  }

  /** Temporary players are editable by whoever manages a team / match they belong to. */
  async update(user: AuthUser, id: string, dto: UpdatePlayerDto) {
    const player = await this.prisma.player.findFirst({ where: { id, deletedAt: null } });
    if (!player) throw new NotFoundException('Player not found');
    if (player.userId && player.userId !== user.id && !this.access.isSuperAdmin(user))
      throw new ForbiddenException('Registered players edit their own profile');
    if (!player.userId && !(await this.canManageTemporary(user, player.id, player.createdById)))
      throw new ForbiddenException('You cannot edit this player');
    const updated = await this.prisma.player.update({ where: { id }, data: dto });
    await this.audit.log({ userId: user.id, entityType: 'PLAYER', entityId: id, action: 'UPDATE', oldValue: player, newValue: dto });
    return updated;
  }

  private async canManageTemporary(user: AuthUser, playerId: string, createdById: string | null) {
    if (this.access.isSuperAdmin(user) || createdById === user.id) return true;
    const teams = await this.prisma.teamPlayer.findMany({ where: { playerId }, select: { teamId: true } });
    for (const t of teams) if (await this.access.canManageTeam(user, t.teamId).catch(() => false)) return true;
    const matches = await this.prisma.matchPlayer.findMany({ where: { playerId }, select: { matchId: true } });
    for (const m of matches) if (await this.access.canManageMatch(user, m.matchId).catch(() => false)) return true;
    return false;
  }

  // ─────────────── Claim match records ───────────────

  async requestClaim(user: AuthUser, dto: CreateClaimDto) {
    const temp = await this.prisma.player.findFirst({ where: { id: dto.temporaryPlayerId, deletedAt: null } });
    if (!temp) throw new NotFoundException('Player not found');
    if (!temp.isTemporary || temp.userId) throw new BadRequestException('Only temporary quick-match players can be claimed');
    const target = await this.ensureForUser(user.id);
    const pending = await this.prisma.playerClaimRequest.findFirst({ where: { temporaryPlayerId: temp.id, status: 'PENDING' } });
    if (pending) {
      if (pending.requestedById === user.id) return pending;
      throw new ConflictException('Another claim for this player is already pending');
    }
    const claim = await this.prisma.playerClaimRequest.create({
      data: { temporaryPlayerId: temp.id, targetPlayerId: target.id, requestedById: user.id, message: dto.message },
    });
    await this.notifications.notifyUsers(await this.claimReviewers(temp.id, temp.createdById), {
      type: NotificationType.CLAIM_UPDATE,
      title: 'Player record claim',
      body: `${user.name} claims the records of "${temp.name}"`,
      data: { claimId: claim.id, temporaryPlayerId: temp.id },
    });
    return claim;
  }

  myClaims(userId: string) {
    return this.prisma.playerClaimRequest.findMany({
      where: { requestedById: userId },
      orderBy: { createdAt: 'desc' },
      include: { temporaryPlayer: { select: { id: true, name: true, tempCode: true } } },
    });
  }

  /** Claims the current user can review (captain / manager / organizer of related team or match). */
  async reviewableClaims(user: AuthUser, q: ClaimQueryDto) {
    const where: Prisma.PlayerClaimRequestWhereInput = {
      status: q.status ?? 'PENDING',
      temporaryPlayer: this.access.isSuperAdmin(user)
        ? undefined
        : {
            OR: [
              { createdById: user.id },
              { teams: { some: { team: { OR: [{ createdById: user.id }, { managerId: user.id }, { captain: { userId: user.id } }] } } } },
              { matchPlayers: { some: { match: { OR: [{ createdById: user.id }, { tournament: { organizerId: user.id } }] } } } },
            ],
          },
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.playerClaimRequest.findMany({
        where,
        ...pageArgs(q),
        orderBy: { createdAt: q.sortOrder },
        include: {
          temporaryPlayer: { select: { id: true, name: true, tempCode: true } },
          targetPlayer: { select: { id: true, name: true, photoUrl: true } },
          requestedBy: { select: { id: true, name: true, email: true, photoUrl: true } },
        },
      }),
      this.prisma.playerClaimRequest.count({ where }),
    ]);
    return paginate(items, total, q);
  }

  async reviewClaim(user: AuthUser, claimId: string, approve: boolean, reason?: string) {
    const claim = await this.prisma.playerClaimRequest.findUnique({ where: { id: claimId }, include: { temporaryPlayer: true } });
    if (!claim) throw new NotFoundException('Claim not found');
    if (claim.status !== 'PENDING') throw new ConflictException(`Claim already ${claim.status.toLowerCase()}`);
    if (!(await this.canManageTemporary(user, claim.temporaryPlayerId, claim.temporaryPlayer.createdById)))
      throw new ForbiddenException('Only the organizer or team captain can review this claim');

    let matchIds: string[] = [];
    if (approve) matchIds = await this.merge(claim.temporaryPlayerId, claim.targetPlayerId);
    await this.prisma.playerClaimRequest.update({
      where: { id: claimId },
      data: { status: approve ? 'ACCEPTED' : 'REJECTED', reviewedById: user.id, reviewedAt: new Date() },
    });
    await this.audit.log({
      userId: user.id,
      entityType: 'PLAYER_CLAIM',
      entityId: claimId,
      action: approve ? 'APPROVE_MERGE' : 'REJECT',
      oldValue: { temporaryPlayerId: claim.temporaryPlayerId },
      newValue: { targetPlayerId: claim.targetPlayerId, matchIds },
      reason,
    });
    await this.notifications.notifyUsers([claim.requestedById], {
      type: NotificationType.CLAIM_UPDATE,
      title: approve ? 'Records claimed' : 'Claim rejected',
      body: approve
        ? `Records of "${claim.temporaryPlayer.name}" (${matchIds.length} matches) were merged into your profile`
        : `Your claim for "${claim.temporaryPlayer.name}" was rejected${reason ? `: ${reason}` : ''}`,
      data: { claimId },
    });
    return { claimId, status: approve ? 'ACCEPTED' : 'REJECTED', mergedMatches: matchIds.length };
  }

  /** Merges a temporary player into a permanent profile and triggers statistics recalculation. */
  private async merge(fromId: string, toId: string): Promise<string[]> {
    const [fromMatches, toMatches] = await Promise.all([
      this.prisma.matchPlayer.findMany({ where: { playerId: fromId }, select: { matchId: true } }),
      this.prisma.matchPlayer.findMany({ where: { playerId: toId }, select: { matchId: true } }),
    ]);
    const statsMatches = await this.prisma.playerMatchStats.findMany({ where: { playerId: fromId }, select: { matchId: true } });
    const matchIds = [...new Set([...fromMatches, ...statsMatches].map((m) => m.matchId))];
    const overlap = matchIds.filter((id) => toMatches.some((m) => m.matchId === id));
    if (overlap.length) throw new ConflictException('Both players appear in the same match; records cannot be merged');

    await this.prisma.$transaction(
      async (tx) => {
        await this.repo.reassignReferences(tx, fromId, toId);
        await tx.playerCareerStats.deleteMany({ where: { playerId: fromId } });
        await tx.player.update({ where: { id: fromId }, data: { deletedAt: new Date(), mergedIntoId: toId } });
        await tx.playerClaimRequest.updateMany({
          where: { temporaryPlayerId: fromId, status: 'PENDING', NOT: { targetPlayerId: toId } },
          data: { status: 'CANCELLED' },
        });
      },
      { timeout: 30_000 },
    );
    this.events.emit(DomainEvent.PLAYERS_MERGED, { playerIds: [toId], matchIds } satisfies PlayersMergedEvent);
    return matchIds;
  }

  private async claimReviewers(playerId: string, createdById: string | null) {
    const teams = await this.prisma.teamPlayer.findMany({
      where: { playerId },
      select: { team: { select: { createdById: true, managerId: true, captain: { select: { userId: true } } } } },
    });
    const matches = await this.prisma.matchPlayer.findMany({
      where: { playerId },
      select: { match: { select: { createdById: true, tournament: { select: { organizerId: true } } } } },
    });
    return [
      createdById,
      ...teams.flatMap((t) => [t.team.createdById, t.team.managerId, t.team.captain?.userId]),
      ...matches.flatMap((m) => [m.match.createdById, m.match.tournament?.organizerId]),
    ].filter(Boolean) as string[];
  }
}
