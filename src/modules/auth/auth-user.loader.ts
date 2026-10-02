import { Injectable } from '@nestjs/common';
import { CacheService } from '../../infrastructure/redis/cache.service';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUser } from '../../common/interfaces/auth-user.interface';

/** Loads the authenticated principal (roles + resolved permissions), cached for 60s. */
@Injectable()
export class AuthUserLoader {
  constructor(
    private readonly prisma: PrismaService,
    private readonly cache: CacheService,
  ) {}

  key(userId: string) {
    return `authuser:${userId}`;
  }

  async load(userId: string): Promise<AuthUser | null> {
    const cached = await this.cache.get<AuthUser | { missing: true }>(this.key(userId));
    if (cached) return 'missing' in cached ? null : cached;

    const user = await this.prisma.user.findFirst({
      where: { id: userId, deletedAt: null, isActive: true },
      include: { roles: { include: { role: true } }, player: { select: { id: true } } },
    });
    if (!user) {
      await this.cache.set(this.key(userId), { missing: true }, 30);
      return null;
    }
    const permissions = new Set<string>();
    user.roles.forEach((ur) => ((ur.role.permissions as string[]) ?? []).forEach((p) => permissions.add(p)));
    const principal: AuthUser = {
      id: user.id,
      email: user.email,
      name: user.name,
      roles: user.roles.map((r) => r.role.name),
      permissions: [...permissions],
      playerId: user.player?.id ?? null,
    };
    await this.cache.set(this.key(userId), principal, 60);
    return principal;
  }

  invalidate(userId: string) {
    return this.cache.del(this.key(userId));
  }
}
