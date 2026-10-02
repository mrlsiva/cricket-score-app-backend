import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { Queue, Worker } from 'bullmq';
import { RedisService } from '../redis/redis.service';

export const QUEUES = {
  NOTIFICATIONS: 'notifications',
  STATS: 'stats',
} as const;
export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

type Handler = (data: any) => Promise<unknown>;

/**
 * Thin wrapper over BullMQ. Handlers are registered by feature modules; when Redis is
 * disabled jobs run in-process on the next tick so behaviour stays identical in dev.
 */
@Injectable()
export class JobsService implements OnModuleDestroy {
  private readonly logger = new Logger(JobsService.name);
  private readonly handlers = new Map<string, Handler>();
  private readonly queues = new Map<QueueName, Queue>();
  private readonly workers: Worker[] = [];

  constructor(private readonly redis: RedisService) {}

  /** Register a processor for `queue:jobName`. Creates the BullMQ worker lazily. */
  register(queue: QueueName, jobName: string, handler: Handler) {
    this.handlers.set(`${queue}:${jobName}`, handler);
    if (this.redis.enabled && !this.workers.find((w) => w.name === queue)) {
      const worker = new Worker(
        queue,
        async (job) => {
          const h = this.handlers.get(`${queue}:${job.name}`);
          if (!h) throw new Error(`No handler for ${queue}:${job.name}`);
          return h(job.data);
        },
        { connection: this.redis.duplicate()!, concurrency: 10 },
      );
      worker.on('failed', (job, err) => this.logger.error(`Job ${queue}:${job?.name} failed: ${err.message}`));
      this.workers.push(worker);
    }
  }

  async add(queue: QueueName, jobName: string, data: unknown, opts: { jobId?: string; delayMs?: number } = {}) {
    if (this.redis.enabled) {
      let q = this.queues.get(queue);
      if (!q) {
        q = new Queue(queue, { connection: this.redis.duplicate()! });
        this.queues.set(queue, q);
      }
      await q.add(jobName, data, {
        jobId: opts.jobId,
        delay: opts.delayMs,
        attempts: 3,
        backoff: { type: 'exponential', delay: 2000 },
        removeOnComplete: 1000,
        removeOnFail: 5000,
      });
      return;
    }
    const handler = this.handlers.get(`${queue}:${jobName}`);
    if (!handler) {
      this.logger.warn(`No handler registered for ${queue}:${jobName}`);
      return;
    }
    setTimeout(() => {
      handler(data).catch((e) => this.logger.error(`Inline job ${queue}:${jobName} failed: ${e?.message}`, e?.stack));
    }, opts.delayMs ?? 0);
  }

  async onModuleDestroy() {
    await Promise.all([...this.workers.map((w) => w.close()), ...[...this.queues.values()].map((q) => q.close())]);
  }
}
