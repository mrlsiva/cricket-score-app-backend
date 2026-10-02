import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { FormEvent, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { MatchCard } from '../components/MatchCard';
import { PlayerPicker, UserPicker } from '../components/pickers';
import {
  Avatar,
  Badge,
  Button,
  Card,
  Checkbox,
  ConfirmButton,
  Empty,
  ErrorBox,
  errText,
  Field,
  Input,
  Loading,
  PageHeader,
  Pagination,
  Select,
  Stat,
  Tabs,
  TeamLogo,
  UploadButton,
  useDebounced,
  useToast,
} from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtAgo, label } from '../lib/format';
import { Any, Match } from '../lib/types';
import { Leaderboard } from './Tournaments';

export function TeamsPage() {
  const { can } = useAuth();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [mine, setMine] = useState(false);
  const q = useDebounced(search);
  const { data, isLoading, error } = useQuery({ queryKey: ['teams', page, q, mine], queryFn: () => api.page<Any>('/teams', { page, limit: 18, search: q, mine: mine || undefined, sortBy: 'name', sortOrder: 'asc' }) });
  return (
    <div>
      <PageHeader
        title="Teams"
        actions={
          <>
            <Link to="/teams/join">
              <Button variant="secondary">Join with code</Button>
            </Link>
            {can('team:create') && (
              <Link to="/teams/new">
                <Button>New team</Button>
              </Link>
            )}
          </>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Input className="max-w-xs" placeholder="Search teams…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Checkbox label="My teams" checked={mine} onChange={setMine} />
      </div>
      {error && <ErrorBox error={error} />}
      {isLoading ? (
        <Loading />
      ) : !data?.items.length ? (
        <Empty title="No teams found" />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.items.map((t) => (
            <Link key={t.id} to={`/teams/${t.id}`} className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm hover:shadow-md">
              <TeamLogo team={t} size={48} />
              <div className="min-w-0">
                <div className="truncate font-bold">{t.name}</div>
                <div className="text-xs text-slate-500">
                  {t._count.players} players{t.captain ? ` · C: ${t.captain.name}` : ''}
                </div>
                {t.stats && (
                  <div className="text-xs text-slate-400">
                    {t.stats.matches} matches · {t.stats.won} won
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

export function TeamFormPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const toast = useToast();
  const { data: team } = useQuery({ queryKey: ['team', id], queryFn: () => api.get<Any>(`/teams/${id}`), enabled: !!id });
  const { data: squad } = useQuery({ queryKey: ['squad', id], queryFn: () => api.get<Any[]>(`/teams/${id}/squad`), enabled: !!id });
  const [v, setV] = useState<Record<string, Any>>({ name: '', shortName: '', color: '#14614a', joinAsPlayer: true, captainId: '', wicketKeeperId: '', managerId: '' });
  const [manager, setManager] = useState<{ id: string; name: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (team) {
      setV({ name: team.name, shortName: team.shortName ?? '', color: team.color ?? '#14614a', captainId: team.captain?.id ?? '', wicketKeeperId: team.wicketKeeper?.id ?? '', managerId: team.manager?.id ?? '' });
      if (team.manager) setManager(team.manager);
    }
  }, [team]);
  const set = (k: string, val: Any) => setV((s) => ({ ...s, [k]: val }));
  const players = (squad ?? []).map((s) => ({ value: s.player.id, label: s.player.name }));
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    const body: Record<string, Any> = { name: v.name, shortName: v.shortName || undefined, color: v.color || undefined, managerId: v.managerId || undefined };
    if (id) Object.assign(body, { captainId: v.captainId || undefined, wicketKeeperId: v.wicketKeeperId || undefined });
    else body.joinAsPlayer = v.joinAsPlayer;
    try {
      const t = id ? await api.patch<Any>(`/teams/${id}`, body) : await api.post<Any>('/teams', body);
      toast(id ? 'Team updated' : 'Team created');
      nav(`/teams/${t.id}`);
    } catch (err) {
      toast(errText(err), 'err');
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit}>
      <PageHeader title={id ? 'Edit team' : 'New team'} back={id ? `/teams/${id}` : '/teams'} />
      <Card>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <Field label="Team name">
            <Input required minLength={2} value={v.name} onChange={(e) => set('name', e.target.value)} />
          </Field>
          <Field label="Short name">
            <Input maxLength={10} value={v.shortName} onChange={(e) => set('shortName', e.target.value.toUpperCase())} />
          </Field>
          <Field label="Team colour">
            <Input type="color" className="h-10 p-1" value={v.color} onChange={(e) => set('color', e.target.value)} />
          </Field>
          <Field label="Manager" hint={manager ? `Current: ${manager.name}` : 'Optional'}>
            <UserPicker
              placeholder="Search manager…"
              onPick={(u) => {
                setManager(u);
                set('managerId', u.id);
              }}
            />
          </Field>
          {id && (
            <>
              <Field label="Captain">
                <Select placeholder="—" options={players} value={v.captainId} onChange={(e) => set('captainId', e.target.value)} />
              </Field>
              <Field label="Wicket keeper">
                <Select placeholder="—" options={players} value={v.wicketKeeperId} onChange={(e) => set('wicketKeeperId', e.target.value)} />
              </Field>
            </>
          )}
        </div>
        {!id && (
          <div className="mt-4">
            <Checkbox label="Add me to the squad" checked={v.joinAsPlayer} onChange={(c) => set('joinAsPlayer', c)} />
          </div>
        )}
        <Button className="mt-4" size="lg" loading={busy}>
          {id ? 'Save' : 'Create team'}
        </Button>
      </Card>
    </form>
  );
}

type TeamTab = 'squad' | 'qr' | 'requests' | 'matches' | 'stats';

export function TeamDetailPage() {
  const { id = '' } = useParams();
  const { user, hasRole } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as TeamTab) || 'squad';
  const { data: team, isLoading, error } = useQuery({ queryKey: ['team', id], queryFn: () => api.get<Any>(`/teams/${id}`) });
  const { data: squad } = useQuery({ queryKey: ['squad', id], queryFn: () => api.get<Any[]>(`/teams/${id}/squad`) });
  // management rights are confirmed by the server; probing the QR endpoint tells the UI
  const { data: qr } = useQuery({ queryKey: ['team-qr', id], queryFn: () => api.get<Any>(`/teams/${id}/qr`), retry: false });
  if (isLoading) return <Loading />;
  if (error || !team) return <ErrorBox error={error} />;
  const canManage = !!qr || hasRole('SUPER_ADMIN');
  const amMember = squad?.some((s) => s.player.userId === user?.id);
  const refresh = () => {
    qc.invalidateQueries({ queryKey: ['team', id] });
    qc.invalidateQueries({ queryKey: ['squad', id] });
  };

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-4 rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="flex items-center gap-4">
          <TeamLogo team={team} size={72} />
          <div>
            <h1 className="text-2xl font-bold">{team.name}</h1>
            <div className="text-sm text-slate-500">
              {team._count.players} players
              {team.captain && ` · Captain ${team.captain.name}`}
              {team.wicketKeeper && ` · WK ${team.wicketKeeper.name}`}
              {team.manager && ` · Manager ${team.manager.name}`}
            </div>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {canManage && (
            <>
              <UploadButton label="Logo" onFile={(f) => api.upload(`/teams/${id}/logo`, f).then(refresh)} />
              <Link to={`/teams/${id}/edit`}>
                <Button size="sm" variant="secondary">
                  Edit
                </Button>
              </Link>
              <ConfirmButton
                title="Delete team?"
                onConfirm={async () => {
                  await api.del(`/teams/${id}`);
                  toast('Team deleted');
                  nav('/teams');
                }}
              >
                Delete
              </ConfirmButton>
            </>
          )}
          {amMember && user?.player && (
            <ConfirmButton variant="secondary" title="Leave this team?" onConfirm={() => api.del(`/teams/${id}/players/${user.player!.id}`).then(refresh)}>
              Leave team
            </ConfirmButton>
          )}
        </div>
      </div>
      <Tabs
        value={tab}
        onChange={(v) => setParams({ tab: v })}
        tabs={[
          { value: 'squad', label: 'Squad' },
          ...(canManage ? [{ value: 'qr' as const, label: 'QR & join code' }, { value: 'requests' as const, label: 'Join requests' }] : []),
          { value: 'matches', label: 'Matches' },
          { value: 'stats', label: 'Stats' },
        ]}
      />
      {tab === 'squad' && <Squad id={id} squad={squad ?? []} team={team} canManage={canManage} onChange={refresh} />}
      {tab === 'qr' && canManage && <QrPanel id={id} />}
      {tab === 'requests' && canManage && <Requests id={id} onChange={refresh} />}
      {tab === 'matches' && <TeamMatches id={id} />}
      {tab === 'stats' && <TeamStats id={id} />}
    </div>
  );
}

function Squad({ id, squad, team, canManage, onChange }: { id: string; squad: Any[]; team: Any; canManage: boolean; onChange: () => void }) {
  const toast = useToast();
  const [name, setName] = useState('');
  const add = async (body: Any) => {
    try {
      await api.post(`/teams/${id}/players`, body);
      toast('Player added');
      setName('');
      onChange();
    } catch (e) {
      toast(errText(e), 'err');
    }
  };
  return (
    <div className="space-y-4">
      {canManage && (
        <Card title="Add players">
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Registered player">
              <PlayerPicker onPick={(p) => add({ playerId: p.id })} />
            </Field>
            <Field label="Temporary player (no account yet)">
              <div className="flex gap-2">
                <Input placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
                <Button disabled={!name.trim()} onClick={() => add({ name })}>
                  Add
                </Button>
              </div>
            </Field>
          </div>
          <p className="mt-2 text-xs text-slate-400">Players can also scan the team QR and request to join.</p>
        </Card>
      )}
      {!squad.length ? (
        <Empty title="No players yet" />
      ) : (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {squad.map((s) => (
            <div key={s.id} className="flex items-center justify-between rounded-xl border border-slate-200 bg-white p-3">
              <Link to={`/players/${s.player.id}`} className="flex items-center gap-3">
                <Avatar name={s.player.name} src={s.player.photoUrl} />
                <div>
                  <div className="font-semibold">
                    {s.player.name}
                    {s.player.jerseyNumber != null && <span className="ml-1 text-slate-400">#{s.player.jerseyNumber}</span>}{' '}
                    {team.captain?.id === s.player.id && <Badge tone="gold">C</Badge>} {team.wicketKeeper?.id === s.player.id && <Badge tone="blue">WK</Badge>}
                  </div>
                  <div className="text-xs text-slate-500">
                    {s.player.role ? label(s.player.role) : s.player.isTemporary ? 'Temporary player' : 'Player'}
                    {s.player.careerStats ? ` · ${s.player.careerStats.runs} runs · ${s.player.careerStats.wickets} wkts` : ''}
                  </div>
                </div>
              </Link>
              {canManage && (
                <ConfirmButton variant="ghost" title={`Remove ${s.player.name}?`} onConfirm={() => api.del(`/teams/${id}/players/${s.player.id}`).then(onChange)}>
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

function QrPanel({ id }: { id: string }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading } = useQuery({ queryKey: ['team-qr', id], queryFn: () => api.get<Any>(`/teams/${id}/qr`) });
  if (isLoading || !data) return <Loading />;
  const webLink = `${window.location.origin}/teams/join?code=${data.joinCode}`;
  return (
    <Card>
      <div className="flex flex-col items-center gap-6 sm:flex-row">
        <img src={data.qrImage} alt="Team QR" className="w-64 rounded-2xl border border-slate-200" />
        <div className="space-y-3">
          <div>
            <div className="text-xs uppercase text-slate-500">Join code</div>
            <div className="font-mono text-4xl font-bold tracking-widest text-pitch-700">{data.joinCode}</div>
          </div>
          <p className="text-sm text-slate-500">Share this QR or code. Players scan it in the app (or open the link), then the captain approves their request.</p>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="secondary" onClick={() => navigator.clipboard.writeText(webLink).then(() => toast('Join link copied'))}>
              Copy join link
            </Button>
            <Button size="sm" variant="secondary" onClick={() => api.download(`/teams/${id}/qr.png`, `${data.teamName}-qr.png`)}>
              Download QR
            </Button>
            <a href={`https://wa.me/?text=${encodeURIComponent(`Join ${data.teamName} on Cricket Scorer: ${webLink} (code ${data.joinCode})`)}`} target="_blank" rel="noreferrer">
              <Button size="sm" variant="secondary">
                Share on WhatsApp
              </Button>
            </a>
            <ConfirmButton
              variant="secondary"
              title="Regenerate QR?"
              message="Old QR codes and join codes stop working."
              onConfirm={() => api.post(`/teams/${id}/qr`, {}, { regenerate: true }).then(() => qc.invalidateQueries({ queryKey: ['team-qr', id] }))}
            >
              Regenerate
            </ConfirmButton>
          </div>
          <p className="break-all text-xs text-slate-400">App deep link: {data.qrPayload}</p>
        </div>
      </div>
    </Card>
  );
}

function Requests({ id, onChange }: { id: string; onChange: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [status, setStatus] = useState('PENDING');
  const { data, isLoading } = useQuery({ queryKey: ['join-requests', id, status], queryFn: () => api.page<Any>(`/teams/${id}/join-requests`, { status, limit: 50 }) });
  const review = useMutation({
    mutationFn: ({ rid, accept }: { rid: string; accept: boolean }) => api.post(`/teams/${id}/join-requests/${rid}/${accept ? 'accept' : 'reject'}`, accept ? undefined : {}),
    onSuccess: (_d, v) => {
      toast(v.accept ? 'Player added to squad' : 'Request rejected');
      qc.invalidateQueries({ queryKey: ['join-requests', id] });
      onChange();
    },
    onError: (e) => toast(errText(e), 'err'),
  });
  return (
    <div className="space-y-3">
      <Select className="max-w-[180px]" options={['PENDING', 'ACCEPTED', 'REJECTED'].map((s) => ({ value: s, label: label(s) }))} value={status} onChange={(e) => setStatus(e.target.value)} />
      {isLoading ? (
        <Loading />
      ) : !data?.items.length ? (
        <Empty title={`No ${status.toLowerCase()} requests`} />
      ) : (
        data.items.map((r) => (
          <div key={r.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-white p-3">
            <div className="flex items-center gap-3">
              <Avatar name={r.user.name} src={r.user.photoUrl} />
              <div>
                <div className="font-semibold">{r.user.name}</div>
                <div className="text-xs text-slate-500">
                  {r.user.city ?? ''} · {fmtAgo(r.createdAt)}
                  {r.message && ` · "${r.message}"`}
                </div>
              </div>
            </div>
            {r.status === 'PENDING' ? (
              <div className="flex gap-2">
                <Button size="sm" onClick={() => review.mutate({ rid: r.id, accept: true })}>
                  Accept
                </Button>
                <Button size="sm" variant="secondary" onClick={() => review.mutate({ rid: r.id, accept: false })}>
                  Reject
                </Button>
              </div>
            ) : (
              <Badge tone={r.status === 'ACCEPTED' ? 'green' : 'gray'}>{r.status}</Badge>
            )}
          </div>
        ))
      )}
    </div>
  );
}

function TeamMatches({ id }: { id: string }) {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useQuery({ queryKey: ['team-matches', id, page], queryFn: () => api.page<Match>('/matches', { teamId: id, page, limit: 12, sortBy: 'scheduledAt' }) });
  if (isLoading) return <Loading />;
  return (
    <>
      {!data?.items.length ? (
        <Empty title="No matches yet" />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.items.map((m) => (
            <MatchCard key={m.id} m={m} />
          ))}
        </div>
      )}
      <Pagination meta={data?.meta} onPage={setPage} />
    </>
  );
}

function TeamStats({ id }: { id: string }) {
  const { data, isLoading } = useQuery({ queryKey: ['team-stats', id], queryFn: () => api.get<Any>(`/statistics/teams/${id}`) });
  if (isLoading) return <Loading />;
  const s = data?.stats;
  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-6">
        <Stat label="Matches" value={s?.matches ?? 0} />
        <Stat label="Won" value={s?.won ?? 0} />
        <Stat label="Lost" value={s?.lost ?? 0} />
        <Stat label="Win %" value={s ? Number(s.winPercentage) : 0} />
        <Stat label="Highest" value={s?.highestTotal ?? 0} />
        <Stat label="Lowest" value={s?.lowestTotal ?? '—'} />
      </div>
      {!!data?.form?.length && (
        <div className="flex items-center gap-2 text-sm">
          <span className="text-slate-500">Form:</span>
          {data.form.map((r: string, i: number) => (
            <Badge key={i} tone={r === 'W' ? 'green' : r === 'L' ? 'red' : 'gray'}>
              {r}
            </Badge>
          ))}
        </div>
      )}
      <div className="grid gap-4 md:grid-cols-2">
        <Leaderboard title="Top run scorers" rows={data?.topBatters ?? []} />
        <Leaderboard title="Top wicket takers" rows={data?.topBowlers ?? []} />
      </div>
    </div>
  );
}

export function JoinTeamPage() {
  const [params] = useSearchParams();
  const toast = useToast();
  const qc = useQueryClient();
  const [code, setCode] = useState(params.get('code') ?? '');
  const [message, setMessage] = useState('');
  const { data: mine } = useQuery({ queryKey: ['my-join-requests'], queryFn: () => api.get<Any[]>('/teams/join-requests/mine') });
  const join = useMutation({
    mutationFn: () => api.post<Any>('/teams/join', { code: code.trim(), message: message || undefined }),
    onSuccess: (r) => {
      toast(`Request sent to ${r.team?.name ?? 'the team'} — waiting for captain approval`);
      setCode('');
      qc.invalidateQueries({ queryKey: ['my-join-requests'] });
    },
    onError: (e) => toast(errText(e), 'err'),
  });
  return (
    <div className="mx-auto max-w-xl space-y-5">
      <PageHeader title="Join a team" subtitle="Enter the join code from the team QR (or open the shared link)." />
      <Card>
        <div className="space-y-3">
          <Field label="Join code">
            <Input className="font-mono text-2xl uppercase tracking-widest" value={code} onChange={(e) => setCode(e.target.value)} placeholder="K7M2QX9A" />
          </Field>
          <Field label="Message to captain (optional)">
            <Input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="Opening batter, available weekends" />
          </Field>
          <Button size="lg" className="w-full" disabled={code.trim().length < 6} loading={join.isPending} onClick={() => join.mutate()}>
            Request to join
          </Button>
        </div>
      </Card>
      <Card title="My requests">
        {!mine?.length ? (
          <p className="text-sm text-slate-400">No requests yet</p>
        ) : (
          <div className="space-y-2">
            {mine.map((r) => (
              <div key={r.id} className="flex items-center justify-between text-sm">
                <Link to={`/teams/${r.team.id}`} className="flex items-center gap-2 font-medium hover:underline">
                  <TeamLogo team={r.team} size={24} />
                  {r.team.name}
                </Link>
                <span className="flex items-center gap-2 text-xs text-slate-400">
                  {fmtAgo(r.createdAt)}
                  <Badge tone={r.status === 'ACCEPTED' ? 'green' : r.status === 'PENDING' ? 'amber' : 'gray'}>{r.status}</Badge>
                </span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
