import { Injectable } from '@nestjs/common';
import { RedisService } from './redis.service';

/** JSON cache backed by Redis, or an in-memory TTL map when Redis is disabled. */
@Injectable()
export class CacheService {
  private readonly memory = new Map<string, { value: string; expiresAt: number }>();

  constructor(private readonly redis: RedisService) {}

  async get<T>(key: string): Promise<T | null> {
    let raw: string | null = null;
    if (this.redis.client) {
      raw = await this.redis.client.get(`cache:${key}`);
    } else {
      const hit = this.memory.get(key);
      if (hit && hit.expiresAt > Date.now()) raw = hit.value;
      else if (hit) this.memory.delete(key);
    }
    return raw ? (JSON.parse(raw) as T) : null;
  }

  async set(key: string, value: unknown, ttlSeconds = 60): Promise<void> {
    const raw = JSON.stringify(value);
    if (this.redis.client) {
      await this.redis.client.set(`cache:${key}`, raw, 'EX', ttlSeconds);
    } else {
      if (this.memory.size > 10_000) this.memory.clear();
      this.memory.set(key, { value: raw, expiresAt: Date.now() + ttlSeconds * 1000 });
    }
  }

  async del(...keys: string[]): Promise<void> {
    if (!keys.length) return;
    if (this.redis.client) await this.redis.client.del(...keys.map((k) => `cache:${k}`));
    else keys.forEach((k) => this.memory.delete(k));
  }

  async wrap<T>(key: string, ttlSeconds: number, factory: () => Promise<T>): Promise<T> {
    const cached = await this.get<T>(key);
    if (cached !== null) return cached;
    const value = await factory();
    await this.set(key, value, ttlSeconds);
    return value;
  }
}
