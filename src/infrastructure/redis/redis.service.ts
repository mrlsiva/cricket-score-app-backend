import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

/**
 * Optional Redis connection. When REDIS_ENABLED=false every consumer falls back to
 * an in-process implementation (fine for a single instance / local development).
 */
@Injectable()
export class RedisService implements OnModuleDestroy {
  private readonly logger = new Logger(RedisService.name);
  readonly client: Redis | null;

  constructor(private readonly config: ConfigService) {
    if (this.config.get<boolean>('redis.enabled')) {
      this.client = new Redis(this.config.get<string>('redis.url')!, { maxRetriesPerRequest: null });
      this.client.on('error', (e) => this.logger.error(`Redis error: ${e.message}`));
      this.client.on('connect', () => this.logger.log('Redis connected'));
    } else {
      this.client = null;
      this.logger.warn('Redis disabled - using in-memory lock/cache/queue (single instance only)');
    }
  }

  get enabled() {
    return this.client !== null;
  }

  /** New connection for subscribers / BullMQ workers (they need dedicated connections). */
  duplicate(): Redis | null {
    return this.client ? this.client.duplicate() : null;
  }

  async onModuleDestroy() {
    await this.client?.quit().catch(() => undefined);
  }
}
