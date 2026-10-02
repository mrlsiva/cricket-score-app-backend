import { RoleName } from '@prisma/client';

export interface AuthUser {
  id: string;
  email: string;
  name: string;
  roles: RoleName[];
  permissions: string[];
  playerId: string | null;
}

export interface JwtPayload {
  sub: string;
  email: string;
  type: 'access';
}
