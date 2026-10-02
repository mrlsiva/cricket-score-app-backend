import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { MatchCard } from '../components/MatchCard';
import { TeamSelect } from '../components/pickers';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  ConfirmButton,
  Empty,
  enumOptions,
  ErrorBox,
  errText,
  Field,
  Input,
  Loading,
  PageHeader,
  Pagination,
  Select,
  Table,
  Tabs,
  TeamLogo,
  Textarea,
  UploadButton,
  useDebounced,
  useToast,
} from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDate, label } from '../lib/format';
import { Any, Match } from '../lib/types';

const TYPES = ['LEAGUE', 'KNOCKOUT', 'LEAGUE_KNOCKOUT', 'FRIENDLY'];
const STATUSES = ['UPCOMING', 'ONGOING', 'COMPLETED', 'CANCELLED'];
const STATUS_TONE: Record<string, string> = { UPCOMING: 'blue', ONGOING: 'red', COMPLETED: 'green', CANCELLED: 'gray' };

export function TournamentsPage() {
  const { can } = useAuth();
  const [page, setPage] = useState(1);
  const [f, setF] = useState({ search: '', status: '', type: '', season: '', mine: false });
  const search = useDebounced(f.search);
  const { data, isLoading, error } = useQuery({
    queryKey: ['tournaments', page, search, f.status, f.type, f.season, f.mine],
    queryFn: () => api.page<Any>('/tournaments', { page, limit: 12, search, status: f.status, type: f.type, season: f.season, mine: f.mine || undefined }),
  });
  return (
    <div>
      <PageHeader
        title="Tournaments"
        subtitle="Leagues, knockouts and friendly series"
        actions={
          can('tournament:create') && (
            <Link to="/tournaments/new">
              <Button>New tournament</Button>
            </Link>
          )
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Input className="max-w-xs" placeholder="Search name, ground, city…" value={f.search} onChange={(e) => setF({ ...f, search: e.target.value })} />
        <Select className="max-w-[150px]" placeholder="Any status" options={enumOptions(STATUSES)} value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })} />
        <Select className="max-w-[180px]" placeholder="Any type" options={enumOptions(TYPES)} value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} />
        <Input className="max-w-[110px]" placeholder="Season" value={f.season} onChange={(e) => setF({ ...f, season: e.target.value })} />
        <Checkbox label="Organized by me" checked={f.mine} onChange={(v) => setF({ ...f, mine: v })} />
      </div>
      {error && <ErrorBox error={error} />}
      {isLoading ? (
        <Loading />
      ) : !data?.items.length ? (
        <Empty title="No tournaments found" />
      ) : (
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {data.items.map((t) => (
            <Link key={t.id} to={`/tournaments/${t.id}`} className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:shadow-md">
              <div className="h-24 bg-gradient-to-r from-pitch-700 to-pitch-500" style={t.bannerUrl ? { backgroundImage: `url(${t.bannerUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined} />
              <div className="-mt-8 p-4">
                <TeamLogo team={{ name: t.name, logoUrl: t.logoUrl }} size={52} />
                <div className="mt-2 flex items-start justify-between gap-2">
                  <h3 className="font-bold">{t.name}</h3>
                  <Badge tone={STATUS_TONE[t.status]}>{label(t.status)}</Badge>
                </div>
                <div className="mt-1 text-sm text-slate-500">
                  {label(t.type)} · {t.overs} ov · {t._count.teams} teams · {t._count.matches} matches
                </div>
                <div className="text-xs text-slate-400">
                  {fmtDate(t.startDate)} – {fmtDate(t.endDate)}
                  {t.ground ? ` · ${t.ground}` : ''}
                </div>
              </div>
            </Link>
          ))}
        </div>
      )}
      <Pagination meta={data?.meta} onPage={setPage} />
    </div>
  );
}

export function TournamentFormPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { data: existing } = useQuery({ queryKey: ['tournament', id], queryFn: () => api.get<Any>(`/tournaments/${id}`), enabled: !!id });
  const [v, setV] = useState<Record<string, Any>>({ name: '', type: 'LEAGUE', overs: 20, playersPerTeam: 11, ballType: 'TENNIS', ground: '', city: '', season: '', startDate: '', endDate: '', description: '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (existing)
      setV({
        name: existing.name,
        type: existing.type,
        overs: existing.overs,
        playersPerTeam: existing.playersPerTeam,
        ballType: existing.ballType,
        ground: existing.ground ?? '',
        city: existing.city ?? '',
        season: existing.season ?? '',
        startDate: existing.startDate.slice(0, 10),
        endDate: existing.endDate.slice(0, 10),
        description: existing.description ?? '',
        status: existing.status,
      });
  }, [existing]);
  const set = (k: string, val: Any) => setV((s) => ({ ...s, [k]: val }));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const body = Object.fromEntries(Object.entries(v).filter(([, x]) => x !== ''));
    try {
      const t = id ? await api.patch<Any>(`/tournaments/${id}`, body) : await api.post<Any>('/tournaments', body);
      toast(id ? 'Tournament updated' : 'Tournament created');
      nav(`/tournaments/${t.id}`);
    } catch (err) {
      toast(errText(err), 'err');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit}>
      <PageHeader title={id ? 'Edit tournament' : 'New tournament'} back={id ? `/tournaments/${id}` : '/tournaments'} />
      <Card>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Name" className="sm:col-span-2">
            <Input required minLength={3} value={v.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field label="Type">
            <Select options={enumOptions(TYPES)} value={v.type} onChange={(e) => set('type', e.target.value)} />
          </Field>
          <Field label="Overs">
            <Input type="number" min={1} max={100} value={v.overs} onChange={(e) => set('overs', +e.target.value)} />
          </Field>
          <Field label="Players per team">
            <Input type="number" min={2} max={15} value={v.playersPerTeam} onChange={(e) => set('playersPerTeam', +e.target.value)} />
          </Field>
          <Field label="Ball type">
            <Select options={enumOptions(['TENNIS', 'LEATHER', 'RUBBER', 'TAPE', 'OTHER'])} value={v.ballType} onChange={(e) => set('ballType', e.target.value)} />
          </Field>
          <Field label="Start date">
            <Input type="date" required value={v.startDate} onChange={(e) => set('startDate', e.target.value)} />
          </Field>
          <Field label="End date">
            <Input type="date" required value={v.endDate} onChange={(e) => set('endDate', e.target.value)} />
          </Field>
          <Field label="Season" hint="Defaults to the start year">
            <Input value={v.season} onChange={(e) => set('season', e.target.value)} />
          </Field>
          <Field label="Ground">
            <Input value={v.ground} onChange={(e) => set('ground', e.target.value)} />
          </Field>
          <Field label="City">
            <Input value={v.city} onChange={(e) => set('city', e.target.value)} />
          </Field>
          {id && (
            <Field label="Status">
              <Select options={enumOptions(STATUSES)} value={v.status} onChange={(e) => set('status', e.target.value)} />
            </Field>
          )}
          <Field label="Description" className="sm:col-span-2 lg:col-span-3">
            <Textarea value={v.description} onChange={(e) => set('description', e.target.value)} />
          </Field>
        </div>
        <Button className="mt-4" size="lg" loading={busy}>
          {id ? 'Save' : 'Create tournament'}
        </Button>
      </Card>
    </form>
  );
}

type TTab = 'fixtures' | 'points' | 'teams' | 'awards' | 'stats' | 'about';

export function TournamentDetailPage() {
  const { id = '' } = useParams();
  const { user, hasRole } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as TTab) || 'fixtures';
  const { data: t, isLoading, error } = useQuery({ queryKey: ['tournament', id], queryFn: () => api.get<Any>(`/tournaments/${id}`) });
  if (isLoading) return <Loading />;
  if (error || !t) return <ErrorBox error={error} />;
  const canManage = t.organizerId === user?.id || hasRole('SUPER_ADMIN');
  const refresh = () => qc.invalidateQueries({ queryKey: ['tournament', id] });

  return (
    <div className="space-y-5">
      <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
        <div className="h-36 bg-gradient-to-r from-pitch-800 to-pitch-500" style={t.bannerUrl ? { backgroundImage: `url(${t.bannerUrl})`, backgroundSize: 'cover', backgroundPosition: 'center' } : undefined} />
        <div className="-mt-10 flex flex-wrap items-end justify-between gap-3 p-5">
          <div className="flex items-end gap-4">
            <TeamLogo team={{ name: t.name, logoUrl: t.logoUrl }} size={80} />
            <div>
              <h1 className="text-2xl font-bold">{t.name}</h1>
              <div className="text-sm text-slate-500">
                {label(t.type)} · {t.overs} overs · {t.playersPerTeam} a side · {label(t.ballType)} ball · Season {t.season}
              </div>
              <div className="text-xs text-slate-400">
                {fmtDate(t.startDate)} – {fmtDate(t.endDate)}
                {t.ground ? ` · ${t.ground}` : ''} · Organizer {t.organizer.name}
              </div>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Badge tone={STATUS_TONE[t.status]}>{label(t.status)}</Badge>
            {canManage && (
              <>
                <UploadButton label="Logo" onFile={(f) => api.upload(`/tournaments/${id}/logo`, f).then(refresh)} />
                <UploadButton label="Banner" onFile={(f) => api.upload(`/tournaments/${id}/banner`, f).then(refresh)} />
                <Link to={`/tournaments/${id}/edit`}>
                  <Button size="sm" variant="secondary">
                    Edit
                  </Button>
                </Link>
                <ConfirmButton
                  title="Delete tournament?"
                  onConfirm={async () => {
                    await api.del(`/tournaments/${id}`);
                    toast('Tournament deleted');
                    nav('/tournaments');
                  }}
                >
                  Delete
                </ConfirmButton>
              </>
            )}
          </div>
        </div>
      </div>
      <Tabs
        value={tab}
        onChange={(v) => setParams({ tab: v })}
        tabs={[
          { value: 'fixtures', label: 'Fixtures' },
          { value: 'points', label: 'Points table' },
          { value: 'teams', label: `Teams (${t._count.teams})` },
          { value: 'awards', label: 'Awards' },
          { value: 'stats', label: 'Stats' },
          { value: 'about', label: 'About' },
        ]}
      />
      {tab === 'fixtures' && <Fixtures t={t} canManage={canManage} />}
      {tab === 'points' && <PointsTable id={id} canManage={canManage} />}
      {tab === 'teams' && <TournamentTeams id={id} canManage={canManage} onChange={refresh} />}
      {tab === 'awards' && <TournamentAwards id={id} />}
      {tab === 'stats' && <TournamentStats id={id} />}
      {tab === 'about' && (
        <Card>
          <p className="whitespace-pre-wrap text-sm text-slate-600">{t.description || 'No description.'}</p>
        </Card>
      )}
    </div>
  );
}

function Fixtures({ t, canManage }: { t: Any; canManage: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading } = useQuery({ queryKey: ['fixtures', t.id], queryFn: () => api.get<Match[]>(`/tournaments/${t.id}/fixtures`) });
  const [o, setO] = useState({ matchesPerDay: 2, startTime: '09:00', gapMinutes: 240, doubleRoundRobin: false });
  const gen = useMutation({
    mutationFn: (regenerate: boolean) => api.post<Any>(`/tournaments/${t.id}/fixtures`, { ...o, regenerate }),
    onSuccess: (r) => {
      toast(`${r.created} fixtures created`);
      qc.invalidateQueries({ queryKey: ['fixtures', t.id] });
      qc.invalidateQueries({ queryKey: ['tournament', t.id] });
    },
    onError: (e) => toast(errText(e), 'err'),
  });
  if (isLoading) return <Loading />;
  const rounds = new Map<string, Match[]>();
  (data ?? []).forEach((m) => {
    const k = m.stage === 'LEAGUE' ? `Round ${m.roundNumber ?? 1}` : label(m.stage);
    rounds.set(k, [...(rounds.get(k) ?? []), m]);
  });
  return (
    <div className="space-y-5">
      {canManage && t.type !== 'FRIENDLY' && (
        <Card title="Generate fixtures" actions={<Link to={`/matches/new?tournamentId=${t.id}`}><Button size="sm" variant="secondary">+ Manual match</Button></Link>}>
          <div className="grid gap-3 sm:grid-cols-4">
            <Field label="Matches per day">
              <Input type="number" min={1} max={10} value={o.matchesPerDay} onChange={(e) => setO({ ...o, matchesPerDay: +e.target.value })} />
            </Field>
            <Field label="First match at">
              <Input type="time" value={o.startTime} onChange={(e) => setO({ ...o, startTime: e.target.value })} />
            </Field>
            <Field label="Gap (minutes)">
              <Input type="number" min={30} value={o.gapMinutes} onChange={(e) => setO({ ...o, gapMinutes: +e.target.value })} />
            </Field>
            <div className="flex items-end">
              <Checkbox label="Double round robin" checked={o.doubleRoundRobin} onChange={(v) => setO({ ...o, doubleRoundRobin: v })} />
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <Button loading={gen.isPending} onClick={() => gen.mutate(false)}>
              Generate
            </Button>
            {!!data?.length && (
              <ConfirmButton variant="secondary" title="Regenerate fixtures?" message="All unplayed fixtures are replaced." onConfirm={() => gen.mutateAsync(true)}>
                Regenerate
              </ConfirmButton>
            )}
          </div>
          <p className="mt-2 text-xs text-slate-400">
            {t.type === 'KNOCKOUT' && 'Seeded bracket; next rounds are created automatically when results come in.'}
            {t.type === 'LEAGUE' && 'Round robin; the tournament completes after the last match.'}
            {t.type === 'LEAGUE_KNOCKOUT' && 'Round robin (per group if groups are set), then the top 4 go to semi-finals and a final automatically.'}
          </p>
        </Card>
      )}
      {canManage && t.type === 'FRIENDLY' && (
        <Link to={`/matches/new?tournamentId=${t.id}`}>
          <Button>+ Add match</Button>
        </Link>
      )}
      {!data?.length ? (
        <Empty title="No fixtures yet" />
      ) : (
        [...rounds.entries()].map(([round, ms]) => (
          <section key={round}>
            <h3 className="mb-2 font-bold text-slate-700">{round}</h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {ms.map((m) => (
                <MatchCard key={m.id} m={{ ...m, innings: m.innings ?? [], tournament: null }} />
              ))}
            </div>
          </section>
        ))
      )}
    </div>
  );
}

function PointsTable({ id, canManage }: { id: string; canManage: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading } = useQuery({ queryKey: ['points', id], queryFn: () => api.get<Any[]>(`/tournaments/${id}/points-table`) });
  if (isLoading) return <Loading />;
  return (
    <Card
      padded={false}
      title="Points table"
      actions={
        canManage && (
          <Button
            size="sm"
            variant="secondary"
            onClick={() =>
              api
                .post(`/tournaments/${id}/points-table/recalculate`)
                .then(() => qc.invalidateQueries({ queryKey: ['points', id] }))
                .then(() => toast('Recalculated'))
                .catch((e) => toast(errText(e), 'err'))
            }
          >
            Recalculate
          </Button>
        )
      }
    >
      {!data?.length ? (
        <div className="p-4">
          <Empty title="Add teams to see the table" />
        </div>
      ) : (
        <div className="p-2">
          <Table head={['#  Team', 'P', 'W', 'L', 'T', 'NR', 'Pts', 'NRR', 'For', 'Against']}>
            {data.map((r) => (
              <tr key={r.team.id} className={r.isEliminated ? 'opacity-50' : ''}>
                <td className="px-2 py-2">
                  <Link to={`/teams/${r.team.id}`} className="flex items-center gap-2 font-semibold hover:underline">
                    <span className="w-5 text-slate-400">{r.position}</span>
                    <TeamLogo team={r.team} size={24} />
                    {r.team.name}
                    {r.groupName && <Badge>{r.groupName}</Badge>}
                  </Link>
                </td>
                <td className="px-2 text-right">{r.played}</td>
                <td className="px-2 text-right">{r.won}</td>
                <td className="px-2 text-right">{r.lost}</td>
                <td className="px-2 text-right">{r.tied}</td>
                <td className="px-2 text-right">{r.noResult}</td>
                <td className="px-2 text-right font-bold">{r.points}</td>
                <td className={`px-2 text-right ${r.netRunRate >= 0 ? 'text-pitch-700' : 'text-ball'}`}>{r.netRunRate > 0 ? '+' : ''}{r.netRunRate.toFixed(3)}</td>
                <td className="px-2 text-right text-xs text-slate-500">{r.runsFor}</td>
                <td className="px-2 text-right text-xs text-slate-500">{r.runsAgainst}</td>
              </tr>
            ))}
          </Table>
        </div>
      )}
    </Card>
  );
}

function TournamentTeams({ id, canManage, onChange }: { id: string; canManage: boolean; onChange: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading } = useQuery({ queryKey: ['tournament-teams', id], queryFn: () => api.get<Any[]>(`/tournaments/${id}/teams`) });
  const [teamId, setTeamId] = useState('');
  const [name, setName] = useState('');
  const [groupName, setGroup] = useState('');
  const [seed, setSeed] = useState('');
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['tournament-teams', id] });
    qc.invalidateQueries({ queryKey: ['points', id] });
    onChange();
  };
  const add = useMutation({
    mutationFn: () => api.post(`/tournaments/${id}/teams`, { teamId: teamId || undefined, name: teamId ? undefined : name, groupName: groupName || undefined, seed: seed ? +seed : undefined }),
    onSuccess: () => {
      setTeamId('');
      setName('');
      setSeed('');
      toast('Team added (team admins notified)');
      refresh();
    },
    onError: (e) => toast(errText(e), 'err'),
  });
  if (isLoading) return <Loading />;
  return (
    <div className="space-y-4">
      {canManage && (
        <Card title="Add team">
          <div className="grid gap-3 sm:grid-cols-5">
            <TeamSelect value={teamId} onChange={setTeamId} placeholder="Existing team…" />
            <Input placeholder="…or new team name" value={name} disabled={!!teamId} onChange={(e) => setName(e.target.value)} />
            <Input placeholder="Group (optional)" value={groupName} onChange={(e) => setGroup(e.target.value)} />
            <Input type="number" placeholder="Seed (knockout)" value={seed} onChange={(e) => setSeed(e.target.value)} />
            <Button disabled={!teamId && name.trim().length < 2} loading={add.isPending} onClick={() => add.mutate()}>
              Add
            </Button>
          </div>
        </Card>
      )}
      {!data?.length ? (
        <Empty title="No teams yet" />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((e) => (
            <div key={e.id} className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-3">
              <Link to={`/teams/${e.team.id}`} className="flex items-center gap-3">
                <TeamLogo team={e.team} />
                <div>
                  <div className="font-semibold">{e.team.name}</div>
                  <div className="text-xs text-slate-500">
                    {e.team._count.players} players{e.groupName ? ` · Group ${e.groupName}` : ''}
                    {e.seed ? ` · Seed ${e.seed}` : ''}
                  </div>
                </div>
              </Link>
              {canManage && (
                <ConfirmButton variant="ghost" title={`Remove ${e.team.name}?`} message="Only possible before the team has played." onConfirm={() => api.del(`/tournaments/${id}/teams/${e.team.id}`).then(refresh)}>
                  ✕
                </ConfirmButton>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function AwardGrid({ awards }: { awards: Any[] }) {
  if (!awards.length) return <Empty title="Awards are calculated automatically after each completed match" />;
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {awards.map((a) => (
        <div key={a.id} className={`rounded-2xl border p-4 ${['MAN_OF_THE_TOURNAMENT', 'MAN_OF_THE_MATCH'].includes(a.type) ? 'border-gold bg-yellow-50' : a.type === 'ORANGE_CAP' ? 'border-orange-300 bg-orange-50' : a.type === 'PURPLE_CAP' ? 'border-violet-300 bg-violet-50' : 'border-slate-200 bg-white'}`}>
          <div className="text-xs font-bold uppercase text-slate-600">{label(a.type)}</div>
          <Link to={a.player ? `/players/${a.player.id}` : '#'} className="mt-1 block text-lg font-bold hover:underline">
            {a.player?.name ?? '—'}
            {a.secondPlayer ? ` & ${a.secondPlayer.name}` : ''}
          </Link>
          <div className="text-sm text-slate-500">{a.value}</div>
        </div>
      ))}
    </div>
  );
}

function TournamentAwards({ id }: { id: string }) {
  const { data, isLoading } = useQuery({ queryKey: ['tournament-awards', id], queryFn: () => api.get<Any[]>(`/tournaments/${id}/awards`) });
  if (isLoading) return <Loading />;
  return <AwardGrid awards={data ?? []} />;
}

export function Leaderboard({ title, rows, unit }: { title: string; rows: Any[]; unit?: string }) {
  return (
    <Card title={title}>
      {!rows?.length ? (
        <p className="text-sm text-slate-400">No data yet</p>
      ) : (
        <ol className="space-y-1.5">
          {rows.map((r) => (
            <li key={r.playerId} className="flex items-center justify-between text-sm">
              <Link to={`/players/${r.playerId}`} className="hover:underline">
                <span className="mr-2 inline-block w-5 text-slate-400">{r.rank}</span>
                {r.player?.name}
              </Link>
              <span className="font-bold tabular">
                {r.value}
                {unit ? ` ${unit}` : ''}
              </span>
            </li>
          ))}
        </ol>
      )}
    </Card>
  );
}

function TournamentStats({ id }: { id: string }) {
  const { data, isLoading } = useQuery({ queryKey: ['tournament-stats', id], queryFn: () => api.get<Any>(`/statistics/tournaments/${id}`) });
  if (isLoading) return <Loading />;
  if (!data) return <Empty title="No statistics yet" />;
  const lb = data.leaderboards ?? {};
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
        {[
          ['Matches', data.matchesPlayed],
          ['Runs', data.totalRuns],
          ['Wickets', data.totalWickets],
          ['Fours', data.totalFours],
          ['Sixes', data.totalSixes],
          ['Highest total', data.highestTotal],
        ].map(([l, v]) => (
          <div key={l} className="rounded-xl border border-slate-200 bg-white p-3 text-center">
            <div className="text-2xl font-bold tabular">{v}</div>
            <div className="text-xs uppercase text-slate-500">{l}</div>
          </div>
        ))}
      </div>
      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-3">
        <Leaderboard title="🟠 Most runs" rows={lb.runs} />
        <Leaderboard title="🟣 Most wickets" rows={lb.wickets} />
        <Leaderboard title="Most sixes" rows={lb.sixes} />
        <Leaderboard title="Best strike rate" rows={lb.strikeRate} />
        <Leaderboard title="Best economy" rows={lb.economy} />
        <Leaderboard title="MVP points" rows={lb.mvp} />
      </div>
    </div>
  );
}
