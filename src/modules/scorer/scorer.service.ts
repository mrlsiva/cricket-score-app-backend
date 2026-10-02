import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { NotificationType, RoleName, TransferStatus } from '@prisma/client';
import { AuthUser } from '../../common/interfaces/auth-user.interface';
import { CacheService } from '../../infrastructure/redis/cache.service';
import { LockService } from '../../infrastructure/redis/lock.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AccessService } from '../access/access.service';
import { AuditService } from '../audit/audit.service';
import { LiveEvent } from '../live/live.events';
import { LiveService } from '../live/live.service';
import { NotificationsService } from '../notifications/notifications.service';
import { RolesService } from '../roles/roles.service';

const TRANSFER_TTL_MS = 5 * 60_000;
const NONE = '__none__';

/**
 * Single-scorer lock per match.
 *  - DB row `scorer_locks` (unique matchId) is the durable source of truth.
 *  - Redis cache gives O(1) holder checks on every ball; all mutations run under a distributed mutex
 *    so two devices can never hold / transfer the lock concurrently.
 */
@Injectable()
export class ScorerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
    private readonly locks: LockService,
    private readonly access: AccessService,
    private readonly live: LiveService,
    private readonly notifications: NotificationsService,
    private readonly audit: AuditService,
    private readonly roles: RolesService,
  ) {}

  private key(matchId: string) {
    return `scorer:${matchId}`;
  }

  async holder(matchId: string): Promise<string | null> {
    const cached = await this.cache.get<string>(this.key(matchId));
    if (cached) return cached === NONE ? null : cached;
    const lock = await this.prisma.scorerLock.findUnique({ where: { matchId } });
    await this.cache.set(this.key(matchId), lock?.userId ?? NONE, 12 * 3600);
    return lock?.userId ?? null;
  }

  /** Throws unless the user currently holds the scorer lock for the match. */
  async assertScorer(user: AuthUser, matchId: string) {
    const holder = await this.holder(matchId);
    if (holder !== user.id) {
      throw new ForbiddenException(
        holder ? 'Another scorer holds the lock for this match. You are in viewer mode.' : 'No active scorer. Claim the scorer lock first.',
      );
    }
  }

  async status(user: AuthUser, matchId: string) {
    const [lock, pending] = await Promise.all([
      this.prisma.scorerLock.findUnique({ where: { matchId }, include: { user: { select: { id: true, name: true, photoUrl: true } } } }),
      this.prisma.scorerTransferHistory.findFirst({
        where: { matchId, status: 'PENDING', expiresAt: { gt: new Date() } },
        include: { toUser: { select: { id: true, name: true } }, fromUser: { select: { id: true, name: true } } },
      }),
    ]);
    return {
      matchId,
      scorer: lock?.user ?? null,
      acquiredAt: lock?.acquiredAt ?? null,
      isMe: lock?.userId === user.id,
      mode: lock?.userId === user.id ? 'SCORER' : 'VIEWER',
      pendingTransfer: pending,
    };
  }

  /** Internal: sets the holder, writes history and broadcasts. Must run inside the match mutex. */
  private async setHolder(matchId: string, fromUserId: string | null, toUserId: string, actorId: string, status: TransferStatus, reason?: string) {
    await this.prisma.$transaction([
      this.prisma.scorerLock.upsert({
        where: { matchId },
        update: { userId: toUserId, acquiredAt: new Date(), heartbeatAt: new Date() },
        create: { matchId, userId: toUserId },
      }),
      this.prisma.scorerTransferHistory.create({ data: { matchId, fromUserId, toUserId, actorId, status, reason, respondedAt: new Date() } }),
      this.prisma.scoreEvent.create({ data: { matchId, type: 'SCORER_CHANGED', userId: actorId, payload: { fromUserId, toUserId, status } } }),
    ]);
    await this.cache.set(this.key(matchId), toUserId, 12 * 3600);
    await this.roles.assign(toUserId, [RoleName.SCORER]);
    const to = await this.prisma.user.findUnique({ where: { id: toUserId }, select: { id: true, name: true, photoUrl: true } });
    this.live.toMatch(matchId, LiveEvent.SCORER_TRANSFER, { fromUserId, scorer: to, status, reason });
    await this.audit.log({ userId: actorId, matchId, entityType: 'SCORER_LOCK', entityId: matchId, action: status, oldValue: { userId: fromUserId }, newValue: { userId: toUserId }, reason });
  }

  private async assertUser(userId: string) {
    const u = await this.prisma.user.findFirst({ where: { id: userId, deletedAt: null, isActive: true } });
    if (!u) throw new NotFoundException('Target user not found');
    return u;
  }

  /** Acquire on match start / claim when free. Organizer or current holder only. */
  async acquire(user: AuthUser, matchId: string, status: TransferStatus = 'CLAIMED') {
    return this.locks.withLock(this.key(matchId), async () => {
      const holder = await this.holder(matchId);
      if (holder === user.id) return this.status(user, matchId);
      if (holder) throw new ConflictException('Another scorer already holds the lock. Ask them to transfer it.');
      if (!(await this.access.canManageMatch(user, matchId))) throw new ForbiddenException('Only the organizer can claim a free scorer lock');
      await this.setHolder(matchId, null, user.id, user.id, status);
      return this.status(user, matchId);
    });
  }

  /** Organizer pre-assigns (or force-assigns) the scorer. */
  async assign(user: AuthUser, matchId: string, toUserId: string, force: boolean, reason?: string) {
    await this.access.assertCanManageMatch(user, matchId);
    await this.assertUser(toUserId);
    return this.locks.withLock(this.key(matchId), async () => {
      const holder = await this.holder(matchId);
      if (holder === toUserId) return this.status(user, matchId);
      if (holder && !force) throw new ConflictException('A scorer is active. Use force transfer to override.');
      await this.prisma.scorerTransferHistory.updateMany({ where: { matchId, status: 'PENDING' }, data: { status: 'CANCELLED', respondedAt: new Date() } });
      await this.setHolder(matchId, holder, toUserId, user.id, holder ? 'FORCED' : 'ASSIGNED', reason);
      if (toUserId !== user.id) {
        await this.notifications.notifyUsers([toUserId], {
          type: NotificationType.SCORER_TRANSFER,
          title: 'You are now the scorer',
          body: `${user.name} assigned you as scorer`,
          data: { matchId },
        });
      }
      return this.status(user, matchId);
    });
  }

  async release(user: AuthUser, matchId: string) {
    return this.locks.withLock(this.key(matchId), async () => {
      const holder = await this.holder(matchId);
      if (holder !== user.id && !(await this.access.canManageMatch(user, matchId))) throw new ForbiddenException('You do not hold the scorer lock');
      if (!holder) return { released: true };
      await this.prisma.$transaction([
        this.prisma.scorerLock.delete({ where: { matchId } }),
        this.prisma.scorerTransferHistory.create({ data: { matchId, fromUserId: holder, toUserId: holder, actorId: user.id, status: 'RELEASED' } }),
      ]);
      await this.cache.set(this.key(matchId), NONE, 12 * 3600);
      this.live.toMatch(matchId, LiveEvent.SCORER_TRANSFER, { fromUserId: holder, scorer: null, status: 'RELEASED' });
      return { released: true };
    });
  }

  /** Step 1: current scorer requests a hand-over to another logged-in user. */
  async requestTransfer(user: AuthUser, matchId: string, toUserId: string, reason?: string) {
    await this.assertScorer(user, matchId);
    if (toUserId === user.id) throw new BadRequestException('You already hold the scorer lock');
    const target = await this.assertUser(toUserId);
    await this.prisma.scorerTransferHistory.updateMany({ where: { matchId, status: 'PENDING' }, data: { status: 'CANCELLED', respondedAt: new Date() } });
    const transfer = await this.prisma.scorerTransferHistory.create({
      data: { matchId, fromUserId: user.id, toUserId, actorId: user.id, status: 'PENDING', reason, expiresAt: new Date(Date.now() + TRANSFER_TTL_MS) },
    });
    this.live.toUser(toUserId, LiveEvent.SCORER_TRANSFER_REQUESTED, { transferId: transfer.id, matchId, from: { id: user.id, name: user.name }, expiresAt: transfer.expiresAt });
    this.live.toMatch(matchId, LiveEvent.SCORER_TRANSFER_REQUESTED, { transferId: transfer.id, fromUserId: user.id, toUser: { id: target.id, name: target.name } });
    await this.notifications.notifyUsers([toUserId], {
      type: NotificationType.SCORER_TRANSFER,
      title: 'Scoring transfer request',
      body: `${user.name} wants you to take over scoring`,
      data: { matchId, transferId: transfer.id },
    });
    return transfer;
  }

  /** Step 2: target user accepts / rejects. Lock changes atomically on accept. */
  async respond(user: AuthUser, transferId: string, accept: boolean) {
    const t = await this.prisma.scorerTransferHistory.findUnique({ where: { id: transferId } });
    if (!t) throw new NotFoundException('Transfer request not found');
    if (t.toUserId !== user.id) throw new ForbiddenException('This transfer is not addressed to you');
    return this.locks.withLock(this.key(t.matchId), async () => {
      const fresh = await this.prisma.scorerTransferHistory.findUniqueOrThrow({ where: { id: transferId } });
      if (fresh.status !== 'PENDING') throw new ConflictException(`Transfer already ${fresh.status.toLowerCase()}`);
      if (fresh.expiresAt && fresh.expiresAt < new Date()) {
        await this.prisma.scorerTransferHistory.update({ where: { id: transferId }, data: { status: 'EXPIRED' } });
        throw new ConflictException('Transfer request expired');
      }
      const holder = await this.holder(t.matchId);
      if (holder !== t.fromUserId) {
        await this.prisma.scorerTransferHistory.update({ where: { id: transferId }, data: { status: 'CANCELLED' } });
        throw new ConflictException('The scorer changed since this request was made');
      }
      if (!accept) {
        await this.prisma.scorerTransferHistory.update({ where: { id: transferId }, data: { status: 'REJECTED', respondedAt: new Date() } });
        if (t.fromUserId) this.live.toUser(t.fromUserId, LiveEvent.SCORER_TRANSFER, { transferId, status: 'REJECTED', matchId: t.matchId });
        return { transferId, status: 'REJECTED' };
      }
      await this.prisma.scorerTransferHistory.update({ where: { id: transferId }, data: { status: 'ACCEPTED', respondedAt: new Date() } });
      await this.setHolder(t.matchId, t.fromUserId, user.id, user.id, 'ACCEPTED', t.reason ?? undefined);
      if (t.fromUserId) {
        await this.notifications.notifyUsers([t.fromUserId], {
          type: NotificationType.SCORER_TRANSFER,
          title: 'Scoring transferred',
          body: `${user.name} is now scoring the match`,
          data: { matchId: t.matchId },
        });
      }
      return { transferId, status: 'ACCEPTED', scorerId: user.id };
    });
  }

  async cancel(user: AuthUser, transferId: string) {
    const res = await this.prisma.scorerTransferHistory.updateMany({
      where: { id: transferId, fromUserId: user.id, status: 'PENDING' },
      data: { status: 'CANCELLED', respondedAt: new Date() },
    });
    if (!res.count) throw new NotFoundException('No pending transfer to cancel');
    return { transferId, status: 'CANCELLED' };
  }

  myPendingTransfers(userId: string) {
    return this.prisma.scorerTransferHistory.findMany({
      where: { toUserId: userId, status: 'PENDING', expiresAt: { gt: new Date() } },
      include: { match: { select: { id: true, name: true, teamA: { select: { name: true } }, teamB: { select: { name: true } } } }, fromUser: { select: { id: true, name: true } } },
    });
  }

  history(matchId: string) {
    return this.prisma.scorerTransferHistory.findMany({
      where: { matchId },
      orderBy: { createdAt: 'desc' },
      include: {
        fromUser: { select: { id: true, name: true } },
        toUser: { select: { id: true, name: true } },
        actor: { select: { id: true, name: true } },
      },
    });
  }

  async heartbeat(user: AuthUser, matchId: string) {
    await this.assertScorer(user, matchId);
    await this.prisma.scorerLock.update({ where: { matchId }, data: { heartbeatAt: new Date() } });
    return { ok: true };
  }
}
