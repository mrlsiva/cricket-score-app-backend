import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { TeamSelect } from '../components/pickers';
import { Badge, Card, Empty, enumOptions, ErrorBox, Field, Input, Loading, PageHeader, Select, Stat, Table, Tabs, useDebounced } from '../components/ui';
import { api } from '../lib/api';
import { fmtDate } from '../lib/format';
import { Any } from '../lib/types';
import { Leaderboard } from './Tournaments';

type Tab = 'leaders' | 'h2h' | 'ground' | 'season';
const CATEGORIES = ['runs', 'wickets', 'sixes', 'fours', 'strikeRate', 'economy', 'catches', 'dismissals', 'mvp'];

export default function StatsPage() {
  const [tab, setTab] = useState<Tab>('leaders');
  return (
    <div className="space-y-4">
      <PageHeader title="Statistics" subtitle="Leaderboards, head-to-head, grounds and seasons" />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[
          { value: 'leaders', label: 'Leaderboards' },
          { value: 'h2h', label: 'Head to head' },
          { value: 'ground', label: 'Grounds' },
          { value: 'season', label: 'Seasons' },
        ]}
      />
      {tab === 'leaders' && <Leaders />}
      {tab === 'h2h' && <HeadToHead />}
      {tab === 'ground' && <Ground />}
      {tab === 'season' && <Season />}
    </div>
  );
}

function Leaders() {
  const [f, setF] = useState({ category: 'runs', tournamentId: '', season: '', ground: '', teamId: '' });
  const season = useDebounced(f.season);
  const ground = useDebounced(f.ground);
  const { data: tournaments } = useQuery({ queryKey: ['tournament-options'], queryFn: () => api.page<Any>('/tournaments', { limit: 100 }) });
  const { data, isLoading, error } = useQuery({
    queryKey: ['leaderboard', f.category, f.tournamentId, season, ground, f.teamId],
    queryFn: () => api.get<Any[]>('/statistics/leaderboards', { category: f.category, tournamentId: f.tournamentId, season, ground, teamId: f.teamId, limit: 25 }),
  });
  return (
    <Card>
      <div className="mb-4 grid gap-3 sm:grid-cols-5">
        <Select options={enumOptions(CATEGORIES)} value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} />
        <Select placeholder="All tournaments" options={(tournaments?.items ?? []).map((t) => ({ value: t.id, label: t.name }))} value={f.tournamentId} onChange={(e) => setF({ ...f, tournamentId: e.target.value })} />
        <Input placeholder="Season (e.g. 2026)" value={f.season} onChange={(e) => setF({ ...f, season: e.target.value })} />
        <Input placeholder="Ground" value={f.ground} onChange={(e) => setF({ ...f, ground: e.target.value })} />
        <TeamSelect value={f.teamId} onChange={(id) => setF({ ...f, teamId: id })} placeholder="All teams" />
      </div>
      {error && <ErrorBox error={error} />}
      {isLoading ? (
        <Loading />
      ) : !data?.length ? (
        <Empty title="No data for this filter" />
      ) : (
        <Table head={['#  Player', 'Value', 'M', 'Runs', 'Balls', 'SR', 'Wkts', 'Overs', 'Econ', '6s']}>
          {data.map((r) => (
            <tr key={r.playerId}>
              <td className="px-2 py-2">
                <span className="mr-2 inline-block w-5 text-slate-400">{r.rank}</span>
                <Link className="font-semibold hover:underline" to={`/players/${r.playerId}`}>
                  {r.player?.name}
                </Link>
              </td>
              <td className="px-2 text-right font-bold text-pitch-700">{r.value}</td>
              <td className="px-2 text-right">{r.matches}</td>
              <td className="px-2 text-right">{r.runs}</td>
              <td className="px-2 text-right">{r.balls}</td>
              <td className="px-2 text-right">{r.strikeRate}</td>
              <td className="px-2 text-right">{r.wickets}</td>
              <td className="px-2 text-right">{r.overs}</td>
              <td className="px-2 text-right">{r.economy}</td>
              <td className="px-2 text-right">{r.sixes}</td>
            </tr>
          ))}
        </Table>
      )}
    </Card>
  );
}

function HeadToHead() {
  const [a, setA] = useState('');
  const [b, setB] = useState('');
  const { data, isLoading, error } = useQuery({ queryKey: ['h2h', a, b], queryFn: () => api.get<Any>('/statistics/head-to-head', { teamA: a, teamB: b }), enabled: !!a && !!b && a !== b });
  return (
    <div className="space-y-4">
      <Card>
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Team A">
            <TeamSelect value={a} onChange={setA} />
          </Field>
          <Field label="Team B">
            <TeamSelect value={b} onChange={setB} />
          </Field>
        </div>
      </Card>
      {error && <ErrorBox error={error} />}
      {isLoading && <Loading />}
      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
            <Stat label="Played" value={data.played} />
            {data.teams.map((t: Any) => (
              <Stat key={t.id} label={`${t.name} wins`} value={data.wins[t.id]} sub={`Highest ${data.highestTotals[t.id]}`} />
            ))}
            <Stat label="Tied" value={data.tied} />
            <Stat label="No result" value={data.noResult} />
          </div>
          <Card title="Recent meetings">
            {!data.recent.length ? (
              <p className="text-sm text-slate-400">They haven't played yet</p>
            ) : (
              data.recent.map((m: Any) => (
                <Link key={m.id} to={`/matches/${m.id}`} className="flex justify-between border-b border-slate-100 py-2 text-sm last:border-0 hover:text-pitch-700">
                  <span>{m.resultText ?? m.resultType}</span>
                  <span className="text-slate-400">
                    {fmtDate(m.completedAt)}
                    {m.ground ? ` · ${m.ground}` : ''}
                  </span>
                </Link>
              ))
            )}
          </Card>
        </>
      )}
    </div>
  );
}

function Ground() {
  const [name, setName] = useState('');
  const q = useDebounced(name, 500);
  const { data, isLoading } = useQuery({ queryKey: ['ground', q], queryFn: () => api.get<Any>('/statistics/grounds', { name: q }), enabled: q.length >= 2 });
  return (
    <div className="space-y-4">
      <Input className="max-w-sm" placeholder="Ground name…" value={name} onChange={(e) => setName(e.target.value)} />
      {isLoading && <Loading />}
      {data && (
        <>
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
            <Stat label="Matches" value={data.matches} />
            <Stat label="Avg 1st inns" value={data.averageFirstInnings} />
            <Stat label="Avg 2nd inns" value={data.averageSecondInnings} />
            <Stat label="Highest" value={data.highestTotal} />
            <Stat label="Lowest" value={data.lowestTotal} />
            <Stat label="Bat-first win %" value={data.battingFirstWinPercentage} />
          </div>
          <div className="grid gap-4 md:grid-cols-2">
            <Leaderboard title="Top batters here" rows={data.topBatters} />
            <Leaderboard title="Top bowlers here" rows={data.topBowlers} />
          </div>
        </>
      )}
    </div>
  );
}

function Season() {
  const [season, setSeason] = useState(String(new Date().getFullYear()));
  const q = useDebounced(season, 500);
  const { data, isLoading } = useQuery({ queryKey: ['season', q], queryFn: () => api.get<Any>(`/statistics/seasons/${encodeURIComponent(q)}`), enabled: !!q });
  return (
    <div className="space-y-4">
      <Input className="max-w-[160px]" value={season} onChange={(e) => setSeason(e.target.value)} />
      {isLoading && <Loading />}
      {data && (
        <>
          <div className="flex flex-wrap items-center gap-2 text-sm">
            <b>{data.matches}</b> completed matches in{' '}
            {data.tournaments.map((t: Any) => (
              <Link key={t.id} to={`/tournaments/${t.id}`}>
                <Badge tone="green">{t.name}</Badge>
              </Link>
            ))}
          </div>
          <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
            <Leaderboard title="Runs" rows={data.leaders.runs} />
            <Leaderboard title="Wickets" rows={data.leaders.wickets} />
            <Leaderboard title="Sixes" rows={data.leaders.sixes} />
            <Leaderboard title="MVP points" rows={data.leaders.mvp} />
          </div>
        </>
      )}
    </div>
  );
}
