import { useMutation, useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Avatar, Badge, Button, Card, Empty, enumOptions, ErrorBox, errText, Input, Loading, PageHeader, Pagination, Select, Stat, Table, TeamLogo, useDebounced, useToast } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDate, label } from '../lib/format';
import { Any } from '../lib/types';
import { AwardGrid } from './Tournaments';

export const PLAYER_ROLES = ['BATSMAN', 'BOWLER', 'ALL_ROUNDER', 'WICKET_KEEPER'];

export function PlayersPage() {
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [temporary, setTemporary] = useState('');
  const [role, setRole] = useState('');
  const q = useDebounced(search);
  const { data, isLoading, error } = useQuery({
    queryKey: ['players', page, q, temporary, role],
    queryFn: () => api.page<Any>('/players', { page, limit: 24, search: q, temporary: temporary || undefined, role, sortBy: 'name', sortOrder: 'asc' }),
  });
  return (
    <div>
      <PageHeader title="Players" subtitle="Registered players and quick-match placeholders" />
      <div className="mb-4 flex flex-wrap gap-2">
        <Input className="max-w-xs" placeholder="Search players…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Select className="max-w-[170px]" placeholder="All players" options={[{ value: 'false', label: 'Registered' }, { value: 'true', label: 'Temporary' }]} value={temporary} onChange={(e) => setTemporary(e.target.value)} />
        <Select className="max-w-[170px]" placeholder="Any role" options={enumOptions(PLAYER_ROLES)} value={role} onChange={(e) => setRole(e.target.value)} />
      </div>
      {error && <ErrorBox error={error} />}
      {isLoading ? (
        <Loading />
      ) : !data?.items.length ? (
        <Empty title="No players found" />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {data.items.map((p) => (
            <Link key={p.id} to={`/players/${p.id}`} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-3 hover:shadow-md">
              <Avatar name={p.name} src={p.photoUrl} size={44} />
              <div className="min-w-0">
                <div className="truncate font-semibold">{p.name}</div>
                <div className="text-xs text-slate-500">
                  {p.isTemporary ? <Badge>temp {p.tempCode}</Badge> : p.role ? label(p.role) : 'Player'}
                </div>
                {p.careerStats && (
                  <div className="text-xs text-slate-400">
                    {p.careerStats.matches} M · {p.careerStats.runs} R · {p.careerStats.wickets} W
                  </div>
                )}
              </div>
            </Link>
          ))}
        </div>
      )}
      <Pagination meta={data?.meta} onPage={setPage} />
    </div>
  );
}

export function PlayerDetailPage() {
  const { id = '' } = useParams();
  const { user } = useAuth();
  const toast = useToast();
  const [page, setPage] = useState(1);
  const { data: p, isLoading, error } = useQuery({ queryKey: ['player', id], queryFn: () => api.get<Any>(`/players/${id}`) });
  const { data: stats } = useQuery({ queryKey: ['player-stats', id], queryFn: () => api.get<Any>(`/statistics/players/${p.id}`), enabled: !!p });
  const { data: matches } = useQuery({ queryKey: ['player-matches', id, page], queryFn: () => api.page<Any>(`/statistics/players/${p.id}/matches`, { page, limit: 10 }), enabled: !!p });
  const claim = useMutation({
    mutationFn: () => api.post('/players/claims', { temporaryPlayerId: p.id }),
    onSuccess: () => toast('Claim requested — the organizer / captain will review it'),
    onError: (e) => toast(errText(e), 'err'),
  });
  if (isLoading) return <Loading />;
  if (error || !p) return <ErrorBox error={error} />;
  const c = p.careerStats ?? {};
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-5 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <Avatar name={p.name} src={p.photoUrl} size={88} />
        <div className="flex-1">
          <h1 className="text-2xl font-bold">
            {p.name} {p.jerseyNumber != null && <span className="text-slate-400">#{p.jerseyNumber}</span>}
          </h1>
          <div className="mt-1 flex flex-wrap gap-2 text-sm text-slate-500">
            {p.isTemporary && <Badge>Temporary {p.tempCode}</Badge>}
            {p.role && <Badge tone="green">{label(p.role)}</Badge>}
            {p.battingStyle && <span>{label(p.battingStyle)} bat</span>}
            {p.bowlingStyle && <span>· {label(p.bowlingStyle)}</span>}
            {p.bowlingArm && <span>({label(p.bowlingArm)} arm)</span>}
            <span>· Joined {fmtDate(p.createdAt)}</span>
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {p.teams.map((t: Any) => (
              <Link key={t.team.id} to={`/teams/${t.team.id}`} className="flex items-center gap-1 rounded-full bg-slate-100 px-2 py-0.5 text-xs hover:bg-slate-200">
                <TeamLogo team={t.team} size={16} /> {t.team.name}
              </Link>
            ))}
          </div>
        </div>
        {p.isTemporary && !p.userId && (
          <Button variant="gold" loading={claim.isPending} onClick={() => claim.mutate()}>
            This was me — claim records
          </Button>
        )}
        {p.userId === user?.id && (
          <Link to="/me">
            <Button variant="secondary">Edit my profile</Button>
          </Link>
        )}
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Card title="Batting">
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Matches" value={c.matches ?? 0} />
            <Stat label="Innings" value={c.battingInnings ?? 0} />
            <Stat label="Runs" value={c.runs ?? 0} />
            <Stat label="Highest" value={`${c.highestScore ?? 0}${c.highestScoreNotOut ? '*' : ''}`} />
            <Stat label="Average" value={Number(c.battingAverage ?? 0)} />
            <Stat label="Strike rate" value={Number(c.strikeRate ?? 0)} />
            <Stat label="Balls" value={c.ballsFaced ?? 0} />
            <Stat label="50s / 100s" value={`${c.fifties ?? 0} / ${c.hundreds ?? 0}`} />
            <Stat label="Ducks" value={c.ducks ?? 0} />
            <Stat label="4s" value={c.fours ?? 0} />
            <Stat label="6s" value={c.sixes ?? 0} />
            <Stat label="Not outs" value={c.notOuts ?? 0} />
          </div>
        </Card>
        <Card title="Bowling">
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Innings" value={c.bowlingInnings ?? 0} />
            <Stat label="Overs" value={c.overs ?? '0.0'} />
            <Stat label="Balls" value={c.ballsBowled ?? 0} />
            <Stat label="Wickets" value={c.wickets ?? 0} />
            <Stat label="Economy" value={Number(c.economy ?? 0)} />
            <Stat label="Average" value={Number(c.bowlingAverage ?? 0)} />
            <Stat label="Maidens" value={c.maidens ?? 0} />
            <Stat label="Best" value={`${c.bestBowlingWickets ?? 0}/${c.bestBowlingRuns ?? 0}`} />
            <Stat label="Runs" value={c.runsConceded ?? 0} />
          </div>
        </Card>
        <Card title="Fielding">
          <div className="grid grid-cols-3 gap-2">
            <Stat label="Catches" value={c.catches ?? 0} />
            <Stat label="Run outs" value={c.runOuts ?? 0} />
            <Stat label="Stumpings" value={c.stumpings ?? 0} />
          </div>
          {!!stats?.recentForm?.length && (
            <div className="mt-4">
              <div className="mb-1 text-xs font-semibold uppercase text-slate-500">Recent form</div>
              <div className="flex flex-wrap gap-1">
                {stats.recentForm.map((f: Any, i: number) => (
                  <Badge key={i} tone="green">
                    {f.batting ?? f.bowling ?? '—'}
                  </Badge>
                ))}
              </div>
            </div>
          )}
        </Card>
      </div>

      <Card title="Match by match" padded={false}>
        {!matches?.items.length ? (
          <div className="p-4">
            <Empty title="No completed matches yet" />
          </div>
        ) : (
          <div className="p-2">
            <Table head={['Match', 'Bat', 'Bowl', 'Field', 'MVP pts']}>
              {matches.items.map((m) => (
                <tr key={m.id}>
                  <td className="px-2 py-2">
                    <Link to={`/matches/${m.match.id}`} className="font-medium hover:underline">
                      {m.match.teamA.name} vs {m.match.teamB.name}
                    </Link>
                    <div className="text-xs text-slate-500">
                      {fmtDate(m.match.completedAt)} · {m.match.resultText}
                    </div>
                  </td>
                  <td className="px-2 text-right">{m.batted ? `${m.runs}${m.isOut ? '' : '*'} (${m.ballsFaced})` : '—'}</td>
                  <td className="px-2 text-right">{m.bowled ? `${m.wickets}/${m.runsConceded}` : '—'}</td>
                  <td className="px-2 text-right">{m.catches + m.runOuts + m.stumpings || '—'}</td>
                  <td className="px-2 text-right font-semibold">{Number(m.mvpPoints)}</td>
                </tr>
              ))}
            </Table>
          </div>
        )}
        <Pagination meta={matches?.meta} onPage={setPage} />
      </Card>

      {!!p.awards?.length && (
        <div>
          <h3 className="mb-2 font-bold">Awards</h3>
          <AwardGrid awards={p.awards.map((a: Any) => ({ ...a, player: { id: p.id, name: p.name } }))} />
        </div>
      )}
    </div>
  );
}
