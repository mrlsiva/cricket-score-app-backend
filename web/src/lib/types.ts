// Lightweight shapes of API responses used by the UI.
/* eslint-disable @typescript-eslint/no-explicit-any */

export type RoleName = 'SUPER_ADMIN' | 'ORGANIZER' | 'SCORER' | 'TEAM_CAPTAIN' | 'TEAM_MANAGER' | 'PLAYER' | 'VIEWER';

export interface PlayerBrief {
  id: string;
  name: string;
  photoUrl?: string | null;
  jerseyNumber?: number | null;
  role?: string | null;
  isTemporary?: boolean;
  tempCode?: string | null;
  userId?: string | null;
}

export interface Me {
  id: string;
  name: string;
  email: string;
  photoUrl?: string | null;
  city?: string | null;
  mobile?: string | null;
  isOnboarded: boolean;
  roles: RoleName[];
  player?: (PlayerBrief & Record<string, any>) | null;
}

export interface TeamBrief {
  id: string;
  name: string;
  shortName?: string | null;
  logoUrl?: string | null;
  color?: string | null;
  isTemporary?: boolean;
}

export interface InningsBrief {
  id: string;
  number: number;
  isSuperOver: boolean;
  battingTeamId: string;
  runs: number;
  wickets: number;
  completedOvers: number;
  ballsInOver: number;
  target?: number | null;
  status: string;
}

export interface Match {
  id: string;
  name?: string | null;
  status: 'SCHEDULED' | 'TOSS_COMPLETED' | 'LIVE' | 'INNINGS_BREAK' | 'COMPLETED' | 'CANCELLED';
  teamAId: string;
  teamBId: string;
  teamA: TeamBrief;
  teamB: TeamBrief;
  tournament?: { id: string; name: string; logoUrl?: string | null } | null;
  tournamentId?: string | null;
  overs: number;
  playersPerTeam: number;
  ground?: string | null;
  scheduledAt?: string | null;
  stage: string;
  isQuickMatch: boolean;
  isPaused: boolean;
  tossWinnerId?: string | null;
  tossDecision?: 'BAT' | 'BOWL' | null;
  resultText?: string | null;
  resultType?: string | null;
  winnerTeamId?: string | null;
  innings: InningsBrief[];
  createdById: string;
  [k: string]: any;
}

export interface Snapshot {
  match: Record<string, any> & { id: string; status: Match['status']; teamA: TeamBrief; teamB: TeamBrief; isPaused: boolean; scorer?: { id: string; name: string } | null };
  innings: { id: string; number: number; isSuperOver: boolean; battingTeamId: string; score: string; overs: string; runRate: number; target?: number | null; status: string }[];
  current: (Record<string, any> & {
    inningsNumber: number;
    battingTeamId: string;
    bowlingTeamId: string;
    score: string;
    overs: string;
    runRate: number;
    target?: number | null;
    status: string;
    striker: BatView | null;
    nonStriker: BatView | null;
    bowler: (Record<string, any> & { id: string; name: string }) | null;
    thisOver: string[];
    needsNewBatsman: boolean;
    needsNewBowler: boolean;
    previousBowlerId?: string | null;
  }) | null;
  updatedAt: string;
}

export interface BatView {
  id: string;
  name: string;
  runs: number;
  balls: number;
  fours: number;
  sixes: number;
  strikeRate: number;
}

export type Any = any;
