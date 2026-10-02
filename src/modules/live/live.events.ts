/**
 * Socket.IO event names (namespace `/live`).
 * Server → client events are emitted to room `match:<matchId>` (and `tournament:<id>` for tournament-wide updates).
 */
export const LiveEvent = {
  // client -> server
  JOIN_MATCH: 'match:join',
  LEAVE_MATCH: 'match:leave',
  JOIN_TOURNAMENT: 'tournament:join',
  LEAVE_TOURNAMENT: 'tournament:leave',

  // server -> client
  MATCH_STARTED: 'match:started',
  TOSS_COMPLETED: 'match:toss',
  BALL_COMPLETED: 'ball:completed',
  BALL_UPDATED: 'ball:updated',
  BALL_DELETED: 'ball:deleted',
  SCORE_UPDATED: 'score:updated',
  WICKET: 'wicket',
  BOUNDARY: 'boundary',
  SIX: 'six',
  MILESTONE: 'milestone',
  OVER_COMPLETED: 'over:completed',
  INNINGS_STARTED: 'innings:started',
  INNINGS_END: 'innings:ended',
  MATCH_END: 'match:ended',
  MATCH_PAUSED: 'match:paused',
  MATCH_RESUMED: 'match:resumed',
  COMMENTARY_UPDATE: 'commentary:update',
  GALLERY_UPDATE: 'gallery:update',
  SCORER_TRANSFER_REQUESTED: 'scorer:transfer-requested',
  SCORER_TRANSFER: 'scorer:changed',
  POINTS_TABLE_UPDATED: 'tournament:points-table',
  AWARDS_UPDATED: 'awards:updated',
  ERROR: 'error',
} as const;

export const matchRoom = (id: string) => `match:${id}`;
export const tournamentRoom = (id: string) => `tournament:${id}`;
export const userRoom = (id: string) => `user:${id}`;
