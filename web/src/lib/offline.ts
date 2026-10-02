/**
 * Offline ball queue for scorers. Balls scored without connectivity are kept (with a client UUID and
 * the crease state) in localStorage and uploaded via POST /matches/:id/balls/sync when back online.
 */
export interface QueuedBall {
  id: string;
  clientSequence: number;
  inningsNumber: number;
  clientCreatedAt: string;
  runs: number;
  extraType?: string;
  wicketType?: string;
  dismissedPlayerId?: string;
  fielderId?: string;
  noBallRunsType?: string;
  strikerId?: string;
  nonStrikerId?: string;
  bowlerId?: string;
}

const key = (matchId: string) => `cs.offline.${matchId}`;

export const offlineQueue = {
  list(matchId: string): QueuedBall[] {
    try {
      return JSON.parse(localStorage.getItem(key(matchId)) ?? '[]');
    } catch {
      return [];
    }
  },
  push(matchId: string, ball: Omit<QueuedBall, 'clientSequence'>) {
    const list = offlineQueue.list(matchId);
    const next = { ...ball, clientSequence: (list.at(-1)?.clientSequence ?? 0) + 1 };
    try {
      localStorage.setItem(key(matchId), JSON.stringify([...list, next]));
    } catch {
      /* storage full / unavailable */
    }
    return next;
  },
  /** Removes balls the server accepted (CREATED / DUPLICATE). */
  remove(matchId: string, ids: string[]) {
    const keep = offlineQueue.list(matchId).filter((b) => !ids.includes(b.id));
    try {
      localStorage.setItem(key(matchId), JSON.stringify(keep));
    } catch {
      /* ignore */
    }
  },
  clear(matchId: string) {
    try {
      localStorage.removeItem(key(matchId));
    } catch {
      /* ignore */
    }
  },
};
