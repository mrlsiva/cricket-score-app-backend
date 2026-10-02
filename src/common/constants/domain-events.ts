/** In-process domain events (EventEmitter2). Heavy listeners hand off to BullMQ jobs. */
export const DomainEvent = {
  /** { matchId } - match finished (or result corrected); triggers stats, awards, points table, fixtures progression. */
  MATCH_COMPLETED: 'match.completed',
  /** { playerIds: string[], matchIds: string[] } - player records merged; career / tournament stats need recalculation. */
  PLAYERS_MERGED: 'players.merged',
} as const;

export interface MatchCompletedEvent {
  matchId: string;
}

export interface PlayersMergedEvent {
  playerIds: string[];
  matchIds: string[];
}
