import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RoleName } from '@prisma/client';
import { PERMISSIONS_KEY, ROLES_KEY } from '../../../common/decorators';
import { AuthUser } from '../../../common/interfaces/auth-user.interface';

/** Global role / permission guard (evaluated after JwtAuthGuard). */
@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    if (ctx.getType() !== 'http') return true;
    const targets = [ctx.getHandler(), ctx.getClass()];
    const roles = this.reflector.getAllAndOverride<RoleName[]>(ROLES_KEY, targets);
    const perms = this.reflector.getAllAndOverride<string[]>(PERMISSIONS_KEY, targets);
    if (!roles?.length && !perms?.length) return true;

    const user = ctx.switchToHttp().getRequest().user as AuthUser | undefined;
    if (!user) throw new ForbiddenException('Authentication required');
    if (user.roles.includes(RoleName.SUPER_ADMIN) || user.permissions.includes('*')) return true;

    if (roles?.length && !roles.some((r) => user.roles.includes(r))) {
      throw new ForbiddenException(`Requires role: ${roles.join(' or ')}`);
    }
    if (perms?.length && !perms.every((p) => user.permissions.includes(p))) {
      throw new ForbiddenException(`Missing permission: ${perms.filter((p) => !user.permissions.includes(p)).join(', ')}`);
    }
    return true;
  }
}
