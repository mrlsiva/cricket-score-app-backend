import { RoleName } from '@prisma/client';

export const Permission = {
  ALL: '*',
  TOURNAMENT_CREATE: 'tournament:create',
  TOURNAMENT_MANAGE: 'tournament:manage',
  TEAM_CREATE: 'team:create',
  TEAM_MANAGE: 'team:manage',
  MATCH_CREATE: 'match:create',
  MATCH_MANAGE: 'match:manage',
  SCORE_WRITE: 'score:write',
  AWARD_OVERRIDE: 'award:override',
  AUDIT_READ: 'audit:read',
  GALLERY_UPLOAD: 'gallery:upload',
  MATCH_VIEW: 'match:view',
  STATS_READ: 'stats:read',
  USER_MANAGE: 'user:manage',
  ROLE_MANAGE: 'role:manage',
} as const;
export type PermissionKey = (typeof Permission)[keyof typeof Permission];

const VIEWER: PermissionKey[] = [Permission.MATCH_VIEW, Permission.STATS_READ];

/** Default permission matrix, seeded into the `roles` table and editable by Super Admin. */
export const DEFAULT_ROLE_PERMISSIONS: Record<RoleName, { description: string; permissions: PermissionKey[] }> = {
  SUPER_ADMIN: { description: 'Full platform access', permissions: [Permission.ALL] },
  ORGANIZER: {
    description: 'Organizes tournaments and manages matches',
    permissions: [
      ...VIEWER,
      Permission.TOURNAMENT_CREATE,
      Permission.TOURNAMENT_MANAGE,
      Permission.TEAM_CREATE,
      Permission.TEAM_MANAGE,
      Permission.MATCH_CREATE,
      Permission.MATCH_MANAGE,
      Permission.SCORE_WRITE,
      Permission.AWARD_OVERRIDE,
      Permission.AUDIT_READ,
      Permission.GALLERY_UPLOAD,
    ],
  },
  SCORER: {
    description: 'Scores matches they hold the scorer lock for',
    permissions: [...VIEWER, Permission.SCORE_WRITE, Permission.GALLERY_UPLOAD],
  },
  TEAM_CAPTAIN: {
    description: 'Captains a team, approves join requests',
    permissions: [...VIEWER, Permission.TEAM_MANAGE, Permission.MATCH_CREATE, Permission.GALLERY_UPLOAD],
  },
  TEAM_MANAGER: {
    description: 'Manages a team roster',
    permissions: [...VIEWER, Permission.TEAM_CREATE, Permission.TEAM_MANAGE, Permission.GALLERY_UPLOAD],
  },
  PLAYER: {
    description: 'Registered player (Individual account)',
    permissions: [...VIEWER, Permission.GALLERY_UPLOAD],
  },
  VIEWER: { description: 'Spectator', permissions: VIEWER },
};

export const ACCOUNT_TYPE_ROLES = {
  ORGANIZER: [RoleName.ORGANIZER, RoleName.VIEWER],
  INDIVIDUAL: [RoleName.PLAYER, RoleName.VIEWER],
} as const;
export type AccountType = keyof typeof ACCOUNT_TYPE_ROLES;
