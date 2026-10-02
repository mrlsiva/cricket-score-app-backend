import { BadRequestException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { NotificationType, Prisma } from '@prisma/client';
import { paginate, pageArgs } from '../../common/dto/pagination.dto';
import { JobsService, QUEUES } from '../../infrastructure/jobs/jobs.service';
import { PrismaService } from '../../prisma/prisma.service';
import { NotificationQueryDto } from './dto/notifications.dto';
import { PushService } from './push.service';

interface NotifyPayload {
  type: NotificationType;
  title: string;
  body: string;
  data?: Record<string, string>;
}

const TOPIC_RE = /^(match|tournament|team)_[0-9a-f-]{36}$/;

@Injectable()
export class NotificationsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jobs: JobsService,
    private readonly push: PushService,
  ) {}

  onModuleInit() {
    this.jobs.register(QUEUES.NOTIFICATIONS, 'push-users', async (job: { userIds: string[] } & NotifyPayload) => {
      const tokens = await this.prisma.deviceToken.findMany({ where: { userId: { in: job.userIds } }, select: { token: true } });
      const invalid = await this.push.sendToTokens(
        tokens.map((t) => t.token),
        { title: job.title, body: job.body, data: { ...(job.data ?? {}), type: job.type } },
      );
      if (invalid.length) await this.prisma.deviceToken.deleteMany({ where: { token: { in: invalid } } });
    });
    this.jobs.register(QUEUES.NOTIFICATIONS, 'push-topic', async (job: { topic: string } & NotifyPayload) => {
      await this.push.sendToTopic(job.topic, { title: job.title, body: job.body, data: { ...(job.data ?? {}), type: job.type } });
    });
  }

  /** Persist in-app notifications and queue a push to the users' devices. */
  async notifyUsers(userIds: (string | null | undefined)[], payload: NotifyPayload) {
    const ids = [...new Set(userIds.filter(Boolean) as string[])];
    if (!ids.length) return;
    await this.prisma.notification.createMany({
      data: ids.map((userId) => ({
        userId,
        type: payload.type,
        title: payload.title,
        body: payload.body,
        data: (payload.data ?? Prisma.DbNull) as Prisma.InputJsonValue,
      })),
    });
    await this.jobs.add(QUEUES.NOTIFICATIONS, 'push-users', { userIds: ids, ...payload });
  }

  /** Broadcast push to a topic (all spectators following a match / tournament). */
  async notifyTopic(topic: string, payload: NotifyPayload) {
    await this.jobs.add(QUEUES.NOTIFICATIONS, 'push-topic', { topic, ...payload });
  }

  async list(userId: string, q: NotificationQueryDto) {
    const where: Prisma.NotificationWhereInput = { userId, readAt: q.unreadOnly ? null : undefined, type: q.type };
    const [items, total, unread] = await this.prisma.$transaction([
      this.prisma.notification.findMany({ where, ...pageArgs(q), orderBy: { createdAt: 'desc' } }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({ where: { userId, readAt: null } }),
    ]);
    const page = paginate(items, total, q);
    return { ...page, meta: { ...page.meta, unread } };
  }

  async markRead(userId: string, id: string) {
    const res = await this.prisma.notification.updateMany({ where: { id, userId }, data: { readAt: new Date() } });
    if (!res.count) throw new NotFoundException('Notification not found');
    return { id, read: true };
  }

  async markAllRead(userId: string) {
    const res = await this.prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } });
    return { updated: res.count };
  }

  registerDevice(userId: string, token: string, platform = 'android') {
    return this.prisma.deviceToken.upsert({ where: { token }, update: { userId, platform }, create: { userId, token, platform } });
  }

  async removeDevice(userId: string, token: string) {
    await this.prisma.deviceToken.deleteMany({ where: { userId, token } });
    return { removed: true };
  }

  async subscribeTopic(userId: string, topic: string, subscribe: boolean) {
    if (!TOPIC_RE.test(topic)) throw new BadRequestException('Topic must look like match_<uuid>, tournament_<uuid> or team_<uuid>');
    const tokens = (await this.prisma.deviceToken.findMany({ where: { userId }, select: { token: true } })).map((t) => t.token);
    if (subscribe) await this.push.subscribe(tokens, topic);
    else await this.push.unsubscribe(tokens, topic);
    return { topic, subscribed: subscribe, devices: tokens.length };
  }
}
