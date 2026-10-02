import { Global, Module } from '@nestjs/common';
import { JobsService } from './jobs/jobs.service';
import { CacheService } from './redis/cache.service';
import { LockService } from './redis/lock.service';
import { RedisService } from './redis/redis.service';
import { StorageService } from './storage/storage.service';

@Global()
@Module({
  providers: [RedisService, LockService, CacheService, JobsService, StorageService],
  exports: [RedisService, LockService, CacheService, JobsService, StorageService],
})
export class InfrastructureModule {}
