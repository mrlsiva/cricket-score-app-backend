import { useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { io, Socket } from 'socket.io-client';
import { tokens } from './api';
import { Snapshot } from './types';

/** One shared Socket.IO connection to the /live namespace. */
let socket: Socket | null = null;
let socketToken: string | null = null;

export function getSocket(): Socket | null {
  const token = tokens.access;
  if (!token) return null;
  if (socket && socketToken === token) return socket;
  socket?.disconnect();
  socketToken = token;
  socket = io('/live', { auth: { token }, transports: ['websocket'] });
  return socket;
}

export function closeSocket() {
  socket?.disconnect();
  socket = null;
  socketToken = null;
}

export interface LiveFeedItem {
  id: number;
  event: string;
  text: string;
}

const EVENT_TEXT: Record<string, (p: Record<string, unknown>) => string> = {
  wicket: (p) => `WICKET! ${p.score ?? ''}`,
  six: (p) => `SIX! ${p.score ?? ''}`,
  boundary: (p) => `FOUR! ${p.score ?? ''}`,
  milestone: (p) => String(p.text ?? 'Milestone'),
  'over:completed': () => 'Over completed',
  'innings:ended': (p) => String(p.summary ?? 'Innings ended'),
  'match:ended': (p) => String(p.resultText ?? 'Match ended'),
  'match:paused': (p) => `Match paused${p.reason ? `: ${p.reason}` : ''}`,
  'match:resumed': () => 'Play resumed',
  'scorer:changed': (p) => `Scorer: ${(p.scorer as { name?: string } | null)?.name ?? 'released'}`,
};

/**
 * Subscribes to a match room. Returns the latest live snapshot pushed by the server and a
 * short feed of highlight events; related React Query caches are invalidated on each event.
 */
export function useLiveMatch(matchId: string | undefined) {
  const qc = useQueryClient();
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null);
  const [feed, setFeed] = useState<LiveFeedItem[]>([]);
  const [connected, setConnected] = useState(false);
  const [spectators, setSpectators] = useState<number | null>(null);

  useEffect(() => {
    const s = getSocket();
    if (!s || !matchId) return;
    let n = 0;
    const join = () => {
      setConnected(true);
      s.emit('match:join', { matchId }, (ack: { spectators?: number }) => setSpectators(ack?.spectators ?? null));
    };
    const onScore = (snap: Snapshot & { matchId: string }) => {
      if (snap.match?.id !== matchId) return;
      setSnapshot(snap);
      qc.setQueryData(['live', matchId], snap);
    };
    const invalidate = (keys: string[]) => () => keys.forEach((k) => qc.invalidateQueries({ queryKey: [k, matchId] }));
    const handlers: Record<string, (p: Record<string, unknown>) => void> = {
      'score:updated': onScore as never,
      'commentary:update': invalidate(['commentary']),
      'gallery:update': invalidate(['gallery']),
      'awards:updated': invalidate(['awards', 'match']),
      'ball:completed': invalidate(['balls', 'scorecard']),
      'ball:updated': invalidate(['balls', 'scorecard', 'commentary']),
      'ball:deleted': invalidate(['balls', 'scorecard', 'commentary']),
      'match:ended': invalidate(['match', 'scorecard']),
      'innings:started': invalidate(['match']),
      'scorer:changed': invalidate(['scorer', 'match']),
      'scorer:transfer-requested': invalidate(['scorer']),
    };
    for (const ev of Object.keys(EVENT_TEXT)) {
      const prev = handlers[ev];
      handlers[ev] = (p) => {
        prev?.(p);
        setFeed((f) => [{ id: ++n + Date.now(), event: ev, text: EVENT_TEXT[ev](p) }, ...f].slice(0, 6));
      };
    }
    Object.entries(handlers).forEach(([ev, h]) => s.on(ev, h));
    s.on('connect', join);
    s.on('disconnect', () => setConnected(false));
    if (s.connected) join();
    return () => {
      s.emit('match:leave', { matchId });
      Object.entries(handlers).forEach(([ev, h]) => s.off(ev, h));
      s.off('connect', join);
    };
  }, [matchId, qc]);

  return { snapshot, feed, connected, spectators };
}

/** Personal events (scorer transfer requests) delivered to the user's own room. */
export function usePersonalEvents(onTransfer: (p: { transferId: string; matchId: string; from: { name: string } }) => void) {
  useEffect(() => {
    const s = getSocket();
    if (!s) return;
    const h = (p: { transferId?: string; matchId: string; from: { name: string } }) => p.transferId && p.from && onTransfer(p as never);
    s.on('scorer:transfer-requested', h);
    return () => {
      s.off('scorer:transfer-requested', h);
    };
  }, [onTransfer]);
}
