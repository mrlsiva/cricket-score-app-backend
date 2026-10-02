import { ConflictException, Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { RedisService } from './redis.service';

const RELEASE_SCRIPT = `
if redis.call("get", KEYS[1]) == ARGV[1] then
  return redis.call("del", KEYS[1])
else
  return 0
end`;

/**
 * Distributed mutex. Redis `SET NX PX` + token-checked release when Redis is enabled,
 * otherwise a per-process promise queue.
 */
@Injectable()
export class LockService {
  private readonly local = new Map<string, Promise<void>>();

  constructor(private readonly redis: RedisService) {}

  async withLock<T>(key: string, fn: () => Promise<T>, opts: { ttlMs?: number; waitMs?: number } = {}): Promise<T> {
    const ttlMs = opts.ttlMs ?? 15_000;
    const waitMs = opts.waitMs ?? 10_000;
    const lockKey = `lock:${key}`;

    if (!this.redis.client) return this.withLocalLock(lockKey, fn);

    const token = randomUUID();
    const deadline = Date.now() + waitMs;
    // spin with small backoff until acquired or timeout
    while (true) {
      const ok = await this.redis.client.set(lockKey, token, 'PX', ttlMs, 'NX');
      if (ok === 'OK') break;
      if (Date.now() > deadline) throw new ConflictException('Resource is busy, please retry');
      await new Promise((r) => setTimeout(r, 25 + Math.random() * 50));
    }
    try {
      return await fn();
    } finally {
      await this.redis.client.eval(RELEASE_SCRIPT, 1, lockKey, token).catch(() => undefined);
    }
  }

  private async withLocalLock<T>(key: string, fn: () => Promise<T>): Promise<T> {
    const previous = this.local.get(key) ?? Promise.resolve();
    let release!: () => void;
    const current = new Promise<void>((r) => (release = r));
    const chained = previous.then(() => current);
    this.local.set(key, chained);
    await previous;
    try {
      return await fn();
    } finally {
      release();
      if (this.local.get(key) === chained) this.local.delete(key);
    }
  }
}
