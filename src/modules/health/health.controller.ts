import { Controller, Get } from '@nestjs/common';
import { ApiOperation, ApiTags } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../../common/decorators';
import { BRANDING } from '../../config/configuration';
import { RedisService } from '../../infrastructure/redis/redis.service';
import { PrismaService } from '../../prisma/prisma.service';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  @Public()
  @SkipThrottle()
  @Get()
  @ApiOperation({ summary: 'Liveness / readiness probe' })
  async check() {
    const db = await this.prisma.$queryRaw`SELECT 1`.then(() => 'up').catch(() => 'down');
    const redis = this.redis.client ? await this.redis.client.ping().then(() => 'up').catch(() => 'down') : 'disabled';
    return { status: db === 'up' && redis !== 'down' ? 'ok' : 'degraded', database: db, redis, uptime: Math.round(process.uptime()), poweredBy: BRANDING };
  }
}
