import { InningsBrief, Match } from './types';

export const fmtDate = (d?: string | null) =>
  d ? new Date(d).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

export const fmtDateTime = (d?: string | null) =>
  d ? new Date(d).toLocaleString(undefined, { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';

export const fmtAgo = (d: string) => {
  const s = Math.round((Date.now() - new Date(d).getTime()) / 1000);
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)}m ago`;
  if (s < 86400) return `${Math.floor(s / 3600)}h ago`;
  return fmtDate(d);
};

export const label = (s?: string | null) =>
  (s ?? '').toLowerCase().replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());

export const inningsScore = (i?: InningsBrief) => (i ? `${i.runs}/${i.wickets} (${i.completedOvers}.${i.ballsInOver})` : '');

/** Main-innings score line of a team in a match. */
export function teamScore(m: Match, teamId: string) {
  const inns = m.innings.filter((i) => i.battingTeamId === teamId && !i.isSuperOver);
  return inns.map(inningsScore).join(' & ');
}

export const STATUS_TONE: Record<string, string> = {
  LIVE: 'red',
  INNINGS_BREAK: 'amber',
  COMPLETED: 'green',
  CANCELLED: 'gray',
  SCHEDULED: 'blue',
  TOSS_COMPLETED: 'blue',
};

export const initials = (name?: string | null) =>
  (name ?? '?')
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

export const toLocalInput = (d?: string | null) => {
  if (!d) return '';
  const dt = new Date(d);
  return new Date(dt.getTime() - dt.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};
