import { Link } from 'react-router-dom';
import { fmtDateTime, label, STATUS_TONE, teamScore } from '../lib/format';
import { Match } from '../lib/types';
import { Badge, TeamLogo } from './ui';

export function MatchCard({ m }: { m: Match }) {
  const live = m.status === 'LIVE' || m.status === 'INNINGS_BREAK';
  const row = (team: Match['teamA']) => (
    <div className="flex items-center justify-between gap-2">
      <div className="flex min-w-0 items-center gap-2">
        <TeamLogo team={team} size={28} />
        <span className={`truncate font-semibold ${m.winnerTeamId === team.id ? 'text-pitch-700' : 'text-slate-800'}`}>{team.name}</span>
      </div>
      <span className="shrink-0 font-bold tabular text-slate-900">{teamScore(m, team.id)}</span>
    </div>
  );
  return (
    <Link to={`/matches/${m.id}`} className="block rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:border-pitch-300 hover:shadow-md">
      <div className="mb-3 flex items-center justify-between gap-2 text-xs text-slate-500">
        <span className="truncate">{m.tournament?.name ?? (m.isQuickMatch ? 'Quick match' : 'Friendly')} · {m.overs} ov</span>
        <Badge tone={STATUS_TONE[m.status]} pulse={m.status === 'LIVE'}>
          {m.isPaused ? 'Paused' : label(m.status)}
        </Badge>
      </div>
      <div className="space-y-2">
        {row(m.teamA)}
        {row(m.teamB)}
      </div>
      <div className="mt-3 truncate text-xs text-slate-500">
        {m.resultText ? <span className="font-semibold text-pitch-700">{m.resultText}</span> : live ? 'In progress' : `${fmtDateTime(m.scheduledAt)}${m.ground ? ` · ${m.ground}` : ''}`}
      </div>
    </Link>
  );
}
