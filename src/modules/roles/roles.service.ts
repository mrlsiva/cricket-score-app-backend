import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { RoleName } from '@prisma/client';
import { DEFAULT_ROLE_PERMISSIONS, Permission } from '../../common/constants/permissions';
import { PrismaService } from '../../prisma/prisma.service';
import { AuthUserLoader } from '../auth/auth-user.loader';

@Injectable()
export class RolesService implements OnModuleInit {
  private readonly logger = new Logger(RolesService.name);
  private roleIds = new Map<RoleName, string>();

  constructor(
    private readonly prisma: PrismaService,
    private readonly loader: AuthUserLoader,
  ) {}

  /** Ensures every role exists (idempotent seed on boot). */
  async onModuleInit() {
    for (const [name, def] of Object.entries(DEFAULT_ROLE_PERMISSIONS) as [RoleName, (typeof DEFAULT_ROLE_PERMISSIONS)[RoleName]][]) {
      const role = await this.prisma.role.upsert({
        where: { name },
        update: {},
        create: { name, description: def.description, permissions: def.permissions },
      });
      this.roleIds.set(name, role.id);
    }
    this.logger.log(`Roles ready: ${[...this.roleIds.keys()].join(', ')}`);
  }

  list() {
    return this.prisma.role.findMany({ orderBy: { name: 'asc' } });
  }

  listPermissions() {
    return Object.values(Permission);
  }

  async updatePermissions(name: RoleName, permissions: string[]) {
    const role = await this.prisma.role.update({ where: { name }, data: { permissions } });
    const users = await this.prisma.userRole.findMany({ where: { roleId: role.id }, select: { userId: true } });
    await Promise.all(users.map((u) => this.loader.invalidate(u.userId)));
    return role;
  }

  async assign(userId: string, roles: RoleName[]) {
    const ids = roles.map((r) => {
      const id = this.roleIds.get(r);
      if (!id) throw new NotFoundException(`Role ${r} not found`);
      return id;
    });
    await this.prisma.userRole.createMany({ data: ids.map((roleId) => ({ userId, roleId })), skipDuplicates: true });
    await this.loader.invalidate(userId);
  }

  async revoke(userId: string, roles: RoleName[]) {
    const ids = roles.map((r) => this.roleIds.get(r)).filter(Boolean) as string[];
    await this.prisma.userRole.deleteMany({ where: { userId, roleId: { in: ids } } });
    await this.loader.invalidate(userId);
  }

  async rolesOf(userId: string) {
    const rows = await this.prisma.userRole.findMany({ where: { userId }, include: { role: true } });
    return rows.map((r) => r.role.name);
  }
}
