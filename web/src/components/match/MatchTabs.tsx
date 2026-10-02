import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../../lib/api';
import { fmtAgo, fmtDateTime, label, toLocalInput } from '../../lib/format';
import { Any, Match } from '../../lib/types';
import { UserPicker } from '../pickers';
import {
  Badge,
  Button,
  Card,
  Checkbox,
  ConfirmButton,
  cx,
  Empty,
  enumOptions,
  errText,
  Field,
  Input,
  Loading,
  Modal,
  Pagination,
  Select,
  Table,
  Textarea,
  UploadButton,
  useToast,
} from '../ui';

const invalidateMatch = (qc: ReturnType<typeof useQueryClient>, id: string) =>
  ['match', 'live', 'scorecard', 'awards', 'scorer'].forEach((k) => qc.invalidateQueries({ queryKey: [k, id] }));

// ─────────────── Commentary ───────────────

const COMM_TONE: Record<string, string> = { WICKET: 'red', SIX: 'purple', BOUNDARY: 'blue', MILESTONE: 'gold', PARTNERSHIP: 'green', OVER_SUMMARY: 'gray', INNINGS_SUMMARY: 'amber', MATCH_SUMMARY: 'amber', MANUAL: 'blue' };

export function CommentaryView({ matchId, canWrite }: { matchId: string; canWrite: boolean }) {
  const [page, setPage] = useState(1);
  const [inningsNumber, setInnings] = useState('');
  const [type, setType] = useState('');
  const [text, setText] = useState('');
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading } = useQuery({
    queryKey: ['commentary', matchId, page, inningsNumber, type],
    queryFn: () => api.page<Any>(`/matches/${matchId}/commentary`, { page, limit: 30, inningsNumber, types: type }),
  });
  const add = useMutation({
    mutationFn: () => api.post(`/matches/${matchId}/commentary`, { text }),
    onSuccess: () => {
      setText('');
      qc.invalidateQueries({ queryKey: ['commentary', matchId] });
    },
    onError: (e) => toast(errText(e), 'err'),
  });
  const del = useMutation({
    mutationFn: (id: string) => api.del(`/matches/${matchId}/commentary/${id}`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['commentary', matchId] }),
    onError: (e) => toast(errText(e), 'err'),
  });
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <Select className="max-w-[160px]" placeholder="All innings" options={[1, 2, 3, 4].map((n) => ({ value: String(n), label: `Innings ${n}` }))} value={inningsNumber} onChange={(e) => setInnings(e.target.value)} />
        <Select className="max-w-[200px]" placeholder="All types" options={enumOptions(Object.keys(COMM_TONE).concat('BALL'))} value={type} onChange={(e) => setType(e.target.value)} />
      </div>
      {canWrite && (
        <div className="flex gap-2">
          <Input placeholder="Add commentary (scorer / organizer)…" value={text} onChange={(e) => setText(e.target.value)} />
          <Button disabled={!text.trim()} loading={add.isPending} onClick={() => add.mutate()}>
            Post
          </Button>
        </div>
      )}
      {isLoading ? (
        <Loading />
      ) : !data?.items.length ? (
        <Empty title="No commentary yet" />
      ) : (
        <div className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
          {data.items.map((c) => (
            <div key={c.id} className={cx('flex gap-3 px-4 py-3', ['OVER_SUMMARY', 'INNINGS_SUMMARY', 'MATCH_SUMMARY'].includes(c.type) && 'bg-slate-50')}>
              <div className="w-12 shrink-0 text-right font-bold tabular text-slate-500">{c.overLabel ?? ''}</div>
              <div className="flex-1 text-sm">
                {c.type !== 'BALL' && (
                  <span className="mr-2">
                    <Badge tone={COMM_TONE[c.type]}>{label(c.type)}</Badge>
                  </span>
                )}
                {c.text}
              </div>
              {canWrite && (
                <button className="text-xs text-slate-400 hover:text-ball" onClick={() => del.mutate(c.id)}>
                  ✕
                </button>
              )}
            </div>
          ))}
        </div>
      )}
      <Pagination meta={data?.meta} onPage={setPage} />
    </div>
  );
}

// ─────────────── Squads ───────────────

function RenamePlayer({ player, onDone }: { player: Any; onDone: () => void }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState(player.name);
  const toast = useToast();
  const save = useMutation({
    mutationFn: () => api.patch(`/players/${player.id}`, { name }),
    onSuccess: () => {
      setOpen(false);
      onDone();
      toast('Player renamed');
    },
    onError: (e) => toast(errText(e), 'err'),
  });
  return (
    <>
      <button className="text-xs text-pitch-600 hover:underline" onClick={() => setOpen(true)}>
        rename
      </button>
      <Modal open={open} onClose={() => setOpen(false)} title={`Rename ${player.tempCode ?? player.name}`} footer={<Button loading={save.isPending} onClick={() => save.mutate()}>Save</Button>}>
        <Field label="Name">
          <Input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
        </Field>
      </Modal>
    </>
  );
}

function SquadEditor({ match, teamId, current, onClose }: { match: Match; teamId: string; current: string[]; onClose: () => void }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: roster } = useQuery({ queryKey: ['squad', teamId], queryFn: () => api.get<Any[]>(`/teams/${teamId}/squad`) });
  const [sel, setSel] = useState<string[]>(current);
  const [captainId, setCaptain] = useState('');
  const [keeperId, setKeeper] = useState('');
  const save = useMutation({
    mutationFn: () => api.post(`/matches/${match.id}/squads`, { teamId, playerIds: sel, captainId: captainId || undefined, keeperId: keeperId || undefined }),
    onSuccess: () => {
      invalidateMatch(qc, match.id);
      toast('Squad saved');
      onClose();
    },
    onError: (e) => toast(errText(e), 'err'),
  });
  const move = (id: string, d: number) =>
    setSel((s) => {
      const i = s.indexOf(id);
      const j = i + d;
      if (j < 0 || j >= s.length) return s;
      const c = [...s];
      [c[i], c[j]] = [c[j], c[i]];
      return c;
    });
  const all = roster?.map((r) => r.player) ?? [];
  const opts = sel.map((id) => ({ value: id, label: all.find((p) => p.id === id)?.name ?? id }));
  return (
    <Modal open onClose={onClose} wide title={`Playing XI · ${teamId === match.teamAId ? match.teamA.name : match.teamB.name}`} footer={<Button loading={save.isPending} onClick={() => save.mutate()}>Save squad ({sel.length})</Button>}>
      <p className="mb-3 text-sm text-slate-500">Tick players, order = batting order. Add players to the team roster on the team page.</p>
      <div className="grid gap-4 sm:grid-cols-2">
        <div>
          <div className="mb-1 text-xs font-semibold uppercase text-slate-500">Roster</div>
          <div className="max-h-80 space-y-1 overflow-y-auto">
            {all.map((p) => (
              <Checkbox key={p.id} label={`${p.name}${p.isTemporary ? ' (temp)' : ''}`} checked={sel.includes(p.id)} onChange={(c) => setSel((s) => (c ? [...s, p.id] : s.filter((x) => x !== p.id)))} />
            ))}
          </div>
        </div>
        <div>
          <div className="mb-1 text-xs font-semibold uppercase text-slate-500">Batting order</div>
          <ol className="space-y-1">
            {sel.map((id, i) => (
              <li key={id} className="flex items-center gap-2 rounded-lg bg-slate-50 px-2 py-1 text-sm">
                <span className="w-5 text-slate-400">{i + 1}</span>
                <span className="flex-1">{all.find((p) => p.id === id)?.name ?? id}</span>
                <button onClick={() => move(id, -1)}>↑</button>
                <button onClick={() => move(id, 1)}>↓</button>
              </li>
            ))}
          </ol>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Field label="Captain">
              <Select placeholder="—" options={opts} value={captainId} onChange={(e) => setCaptain(e.target.value)} />
            </Field>
            <Field label="Keeper">
              <Select placeholder="—" options={opts} value={keeperId} onChange={(e) => setKeeper(e.target.value)} />
            </Field>
          </div>
        </div>
      </div>
    </Modal>
  );
}

export function SquadsView({ match, canManage }: { match: Match; canManage: boolean }) {
  const qc = useQueryClient();
  const [editing, setEditing] = useState<string | null>(null);
  const refresh = () => invalidateMatch(qc, match.id);
  const editable = canManage && !['COMPLETED', 'CANCELLED'].includes(match.status);
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {[
        [match.teamA, match.squads.teamA],
        [match.teamB, match.squads.teamB],
      ].map(([team, squad]: Any) => (
        <Card key={team.id} title={team.name} actions={editable && <Button size="sm" variant="secondary" onClick={() => setEditing(team.id)}>Edit XI</Button>}>
          {!squad.length ? (
            <Empty title="Squad not set">Defaults to the team roster at match start.</Empty>
          ) : (
            <ol className="space-y-1">
              {squad.map((mp: Any) => (
                <li key={mp.id} className="flex items-center justify-between rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50">
                  <span>
                    <span className="mr-2 text-slate-400">{mp.battingOrder}</span>
                    <Link to={`/players/${mp.player.id}`} className="font-medium hover:underline">
                      {mp.player.name}
                    </Link>
                    {mp.isCaptain && <Badge tone="gold">C</Badge>} {mp.isKeeper && <Badge tone="blue">WK</Badge>} {mp.player.isTemporary && <Badge>temp</Badge>}
                  </span>
                  {mp.player.isTemporary && canManage && <RenamePlayer player={mp.player} onDone={refresh} />}
                </li>
              ))}
            </ol>
          )}
        </Card>
      ))}
      {editing && <SquadEditor match={match} teamId={editing} current={(editing === match.teamAId ? match.squads.teamA : match.squads.teamB).map((m: Any) => m.player.id)} onClose={() => setEditing(null)} />}
    </div>
  );
}

// ─────────────── Gallery ───────────────

export function GalleryView({ matchId, userId, canManage }: { matchId: string; userId: string; canManage: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const [page, setPage] = useState(1);
  const [type, setType] = useState('');
  const [caption, setCaption] = useState('');
  const { data, isLoading } = useQuery({ queryKey: ['gallery', matchId, page, type], queryFn: () => api.page<Any>(`/matches/${matchId}/gallery`, { page, limit: 24, type }) });
  const refresh = () => qc.invalidateQueries({ queryKey: ['gallery', matchId] });
  return (
    <div className="space-y-4">
      <Card>
        <div className="flex flex-wrap items-end gap-2">
          <Field label="Caption" className="min-w-[220px] flex-1">
            <Input value={caption} onChange={(e) => setCaption(e.target.value)} placeholder="Optional caption" />
          </Field>
          <UploadButton
            size="md"
            label="Upload photo / video"
            accept="image/*,video/*"
            onFile={async (f) => {
              await api.upload(`/matches/${matchId}/gallery`, f, { caption });
              setCaption('');
              refresh();
            }}
          />
          <Select className="max-w-[150px]" placeholder="All media" options={[{ value: 'PHOTO', label: 'Photos' }, { value: 'VIDEO', label: 'Videos' }]} value={type} onChange={(e) => setType(e.target.value)} />
        </div>
        <p className="mt-2 text-xs text-slate-400">Players, scorers and organizers of this match can upload. Images ≤ 10 MB, videos ≤ 100 MB.</p>
      </Card>
      {isLoading ? (
        <Loading />
      ) : !data?.items.length ? (
        <Empty title="No photos or videos yet" />
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
          {data.items.map((g) => (
            <figure key={g.id} className="overflow-hidden rounded-xl border border-slate-200 bg-white">
              {g.type === 'VIDEO' ? <video src={g.url} controls className="aspect-video w-full bg-black" /> : <img src={g.url} alt={g.caption ?? ''} className="aspect-square w-full object-cover" />}
              <figcaption className="p-2 text-xs">
                <div className="truncate">{g.caption || <span className="text-slate-400">No caption</span>}</div>
                <div className="flex items-center justify-between text-slate-400">
                  <span>
                    {g.uploadedBy?.name} · {fmtAgo(g.createdAt)}
                  </span>
                  {(g.uploadedById === userId || canManage) && (
                    <span className="flex gap-2">
                      <button
                        className="hover:text-pitch-600"
                        onClick={async () => {
                          const c = prompt('Caption', g.caption ?? '');
                          if (c === null) return;
                          try {
                            await api.patch(`/matches/${matchId}/gallery/${g.id}`, { caption: c });
                            refresh();
                          } catch (e) {
                            toast(errText(e), 'err');
                          }
                        }}
                      >
                        edit
                      </button>
                      <button
                        className="hover:text-ball"
                        onClick={async () => {
                          if (!confirm('Delete this media?')) return;
                          try {
                            await api.del(`/matches/${matchId}/gallery/${g.id}`);
                            refresh();
                          } catch (e) {
                            toast(errText(e), 'err');
                          }
                        }}
                      >
                        delete
                      </button>
                    </span>
                  )}
                </div>
              </figcaption>
            </figure>
          ))}
        </div>
      )}
      <Pagination meta={data?.meta} onPage={setPage} />
    </div>
  );
}

// ─────────────── Awards ───────────────

const MATCH_AWARDS = ['MAN_OF_THE_MATCH', 'BEST_BATSMAN', 'BEST_BOWLER', 'BEST_FIELDER', 'MOST_SIXES', 'MOST_FOURS', 'HIGHEST_PARTNERSHIP'];

export function AwardsView({ match, canOverride }: { match: Match; canOverride: boolean }) {
  const qc = useQueryClient();
  const toast = useToast();
  const { data, isLoading } = useQuery({ queryKey: ['awards', match.id], queryFn: () => api.get<Any[]>(`/matches/${match.id}/awards`) });
  const [type, setType] = useState('MAN_OF_THE_MATCH');
  const [playerId, setPlayer] = useState('');
  const [note, setNote] = useState('');
  const players = [...match.squads.teamA, ...match.squads.teamB].map((m: Any) => ({ value: m.player.id, label: m.player.name }));
  const override = useMutation({
    mutationFn: () => api.put(`/matches/${match.id}/awards/${type}`, { playerId, note: note || undefined }),
    onSuccess: () => {
      toast('Award overridden');
      qc.invalidateQueries({ queryKey: ['awards', match.id] });
    },
    onError: (e) => toast(errText(e), 'err'),
  });
  const clear = useMutation({
    mutationFn: (t: string) => api.del(`/matches/${match.id}/awards/${t}/override`),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['awards', match.id] }),
    onError: (e) => toast(errText(e), 'err'),
  });
  if (isLoading) return <Loading />;
  return (
    <div className="space-y-4">
      {!data?.length ? (
        <Empty title="Awards are calculated automatically when the match completes" />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.map((a) => (
            <div key={a.id} className={cx('rounded-2xl border p-4', a.type === 'MAN_OF_THE_MATCH' ? 'border-gold bg-yellow-50' : 'border-slate-200 bg-white')}>
              <div className="text-xs font-bold uppercase text-yellow-800">{a.type === 'MAN_OF_THE_MATCH' ? '🏆 Player of the Match' : label(a.type)}</div>
              <div className="mt-1 text-lg font-bold">
                {a.player?.name}
                {a.secondPlayer ? ` & ${a.secondPlayer.name}` : ''}
              </div>
              <div className="text-sm text-slate-500">{a.value}</div>
              {a.isOverridden && (
                <div className="mt-2 flex items-center gap-2">
                  <Badge tone="purple">Organizer choice</Badge>
                  {canOverride && (
                    <button className="text-xs text-pitch-600 hover:underline" onClick={() => clear.mutate(a.type)}>
                      reset to automatic
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
      {canOverride && match.status === 'COMPLETED' && (
        <Card title="Override an award">
          <div className="grid gap-3 sm:grid-cols-4">
            <Select options={enumOptions(MATCH_AWARDS)} value={type} onChange={(e) => setType(e.target.value)} />
            <Select placeholder="Player" options={players} value={playerId} onChange={(e) => setPlayer(e.target.value)} />
            <Input placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} />
            <Button disabled={!playerId} loading={override.isPending} onClick={() => override.mutate()}>
              Override
            </Button>
          </div>
        </Card>
      )}
    </div>
  );
}

// ─────────────── Timeline & audit ───────────────

export function TimelineView({ matchId }: { matchId: string }) {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useQuery({ queryKey: ['timeline', matchId, page], queryFn: () => api.page<Any>(`/matches/${matchId}/timeline`, { page, limit: 50 }) });
  if (isLoading) return <Loading />;
  return (
    <>
      <div className="rounded-2xl border border-slate-200 bg-white">
        {data?.items.map((e) => (
          <div key={e.id} className="flex flex-wrap items-center gap-3 border-b border-slate-100 px-4 py-2 text-sm last:border-0">
            <span className="w-32 text-xs text-slate-400">{fmtDateTime(e.createdAt)}</span>
            <Badge tone={e.type.includes('DELETED') || e.type.includes('UNDONE') ? 'red' : e.type.includes('EDITED') ? 'amber' : 'green'}>{label(e.type)}</Badge>
            {e.inningsNo && <span className="text-xs text-slate-500">Inns {e.inningsNo}</span>}
            <span className="truncate text-xs text-slate-500">{e.payload ? JSON.stringify(e.payload) : ''}</span>
          </div>
        ))}
      </div>
      <Pagination meta={data?.meta} onPage={setPage} />
    </>
  );
}

export function AuditView({ matchId }: { matchId: string }) {
  const [page, setPage] = useState(1);
  const { data, isLoading, error } = useQuery({ queryKey: ['audit', matchId, page], queryFn: () => api.page<Any>(`/matches/${matchId}/audit-logs`, { page, limit: 30 }) });
  if (isLoading) return <Loading />;
  if (error) return <Empty title="Audit history is visible to the match organizer only" />;
  return <AuditTable items={data?.items ?? []} meta={data?.meta} onPage={setPage} />;
}

export function AuditTable({ items, meta, onPage }: { items: Any[]; meta?: Any; onPage: (p: number) => void }) {
  const [open, setOpen] = useState<Any>(null);
  if (!items.length) return <Empty title="No audit entries" />;
  return (
    <>
      <Card padded={false}>
        <Table head={['When', 'User', 'Action', 'Ball', 'Reason', '']}>
          {items.map((a) => (
            <tr key={a.id}>
              <td className="px-2 py-2 text-xs text-slate-500">{fmtDateTime(a.createdAt)}</td>
              <td className="px-2 text-right">{a.user?.name ?? '—'}</td>
              <td className="px-2 text-right">
                <Badge tone="blue">
                  {a.entityType} · {a.action}
                </Badge>
              </td>
              <td className="px-2 text-right">{a.ballLabel ?? ''}</td>
              <td className="px-2 text-right text-xs">{a.reason ?? ''}</td>
              <td className="px-2 text-right">
                <button className="text-xs text-pitch-600 hover:underline" onClick={() => setOpen(a)}>
                  diff
                </button>
              </td>
            </tr>
          ))}
        </Table>
      </Card>
      <Pagination meta={meta} onPage={onPage} />
      <Modal open={!!open} onClose={() => setOpen(null)} wide title="Change details">
        <div className="grid gap-3 sm:grid-cols-2">
          {(['oldValue', 'newValue'] as const).map((k) => (
            <div key={k}>
              <div className="mb-1 text-xs font-semibold uppercase text-slate-500">{k === 'oldValue' ? 'Old value' : 'New value'}</div>
              <pre className="max-h-96 overflow-auto rounded-lg bg-slate-900 p-3 text-xs text-green-200">{JSON.stringify(open?.[k], null, 2) ?? '—'}</pre>
            </div>
          ))}
        </div>
      </Modal>
    </>
  );
}

// ─────────────── Manage ───────────────

export function ManageView({ match }: { match: Match }) {
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const refresh = () => invalidateMatch(qc, match.id);
  const preStart = ['SCHEDULED', 'TOSS_COMPLETED'].includes(match.status);
  const [toss, setToss] = useState({ tossWinnerId: match.tossWinnerId ?? '', tossDecision: match.tossDecision ?? 'BAT' });
  const [edit, setEdit] = useState<Record<string, Any>>({ name: match.name ?? '', ground: match.ground ?? '', umpireName: match.umpireName ?? '', scheduledAt: toLocalInput(match.scheduledAt), overs: match.overs, playersPerTeam: match.playersPerTeam });
  const [result, setResult] = useState({ resultType: 'NO_RESULT', winnerTeamId: '', winMargin: '', winMarginType: 'RUNS', resultText: '', reason: '' });
  const [force, setForce] = useState(false);
  const { data: history } = useQuery({ queryKey: ['scorer', match.id, 'history'], queryFn: () => api.get<Any[]>(`/matches/${match.id}/scorer/history`) });
  const run = async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast(ok);
      refresh();
    } catch (e) {
      toast(errText(e), 'err');
    }
  };
  const teams = [
    { value: match.teamAId, label: match.teamA.name },
    { value: match.teamBId, label: match.teamB.name },
  ];

  return (
    <div className="grid gap-4 lg:grid-cols-2">
      {preStart && (
        <Card title="Toss">
          <div className="grid gap-3 sm:grid-cols-3">
            <Select placeholder="Won by" options={teams} value={toss.tossWinnerId} onChange={(e) => setToss({ ...toss, tossWinnerId: e.target.value })} />
            <Select options={[{ value: 'BAT', label: 'Bat' }, { value: 'BOWL', label: 'Bowl' }]} value={toss.tossDecision} onChange={(e) => setToss({ ...toss, tossDecision: e.target.value as 'BAT' })} />
            <Button disabled={!toss.tossWinnerId} onClick={() => run(() => api.post(`/matches/${match.id}/toss`, toss), 'Toss recorded')}>
              Save toss
            </Button>
          </div>
        </Card>
      )}
      <Card title="Edit match">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Name">
            <Input value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
          </Field>
          <Field label="Ground">
            <Input value={edit.ground} onChange={(e) => setEdit({ ...edit, ground: e.target.value })} />
          </Field>
          <Field label="Umpire">
            <Input value={edit.umpireName} onChange={(e) => setEdit({ ...edit, umpireName: e.target.value })} />
          </Field>
          <Field label="Date & time">
            <Input type="datetime-local" value={edit.scheduledAt} onChange={(e) => setEdit({ ...edit, scheduledAt: e.target.value })} />
          </Field>
          {preStart && (
            <>
              <Field label="Overs">
                <Input type="number" value={edit.overs} onChange={(e) => setEdit({ ...edit, overs: +e.target.value })} />
              </Field>
              <Field label="Players per team">
                <Input type="number" value={edit.playersPerTeam} onChange={(e) => setEdit({ ...edit, playersPerTeam: +e.target.value })} />
              </Field>
            </>
          )}
        </div>
        <Button
          className="mt-3"
          onClick={() =>
            run(
              () =>
                api.patch(`/matches/${match.id}`, {
                  name: edit.name || undefined,
                  ground: edit.ground || undefined,
                  umpireName: edit.umpireName || undefined,
                  scheduledAt: edit.scheduledAt ? new Date(edit.scheduledAt).toISOString() : undefined,
                  ...(preStart ? { overs: edit.overs, playersPerTeam: edit.playersPerTeam } : {}),
                }),
              'Match updated',
            )
          }
        >
          Save changes
        </Button>
      </Card>

      <Card title="Scorer">
        <p className="mb-2 text-sm text-slate-500">
          Current scorer: <b>{match.scorerLock?.user?.name ?? 'none'}</b>
        </p>
        <Field label="Assign / force-transfer scorer">
          <UserPicker onPick={(u) => run(() => api.post(`/matches/${match.id}/scorer/assign`, { toUserId: u.id, force, reason: force ? 'Organizer force transfer' : undefined }), `${u.name} is now the scorer`)} />
        </Field>
        <div className="mt-2 flex items-center justify-between">
          <Checkbox label="Force (override the active scorer)" checked={force} onChange={setForce} />
          {match.scorerLock && (
            <Button size="sm" variant="secondary" onClick={() => run(() => api.post(`/matches/${match.id}/scorer/release`), 'Scorer lock released')}>
              Release lock
            </Button>
          )}
        </div>
        {!!history?.length && (
          <div className="mt-3 max-h-48 space-y-1 overflow-y-auto text-xs">
            {history.map((h) => (
              <div key={h.id} className="flex justify-between gap-2 border-b border-slate-100 py-1">
                <span>
                  <Badge>{h.status}</Badge> {h.fromUser?.name ?? '—'} → {h.toUser?.name}
                </span>
                <span className="text-slate-400">{fmtDateTime(h.createdAt)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card title="Result override">
        <div className="grid gap-3 sm:grid-cols-2">
          <Select options={enumOptions(['WIN', 'TIE', 'NO_RESULT', 'ABANDONED'])} value={result.resultType} onChange={(e) => setResult({ ...result, resultType: e.target.value })} />
          {result.resultType === 'WIN' && <Select placeholder="Winner" options={teams} value={result.winnerTeamId} onChange={(e) => setResult({ ...result, winnerTeamId: e.target.value })} />}
          {result.resultType === 'WIN' && (
            <div className="flex gap-2">
              <Input type="number" placeholder="Margin" value={result.winMargin} onChange={(e) => setResult({ ...result, winMargin: e.target.value })} />
              <Select options={enumOptions(['RUNS', 'WICKETS'])} value={result.winMarginType} onChange={(e) => setResult({ ...result, winMarginType: e.target.value })} />
            </div>
          )}
          <Input placeholder="Result text (optional)" value={result.resultText} onChange={(e) => setResult({ ...result, resultText: e.target.value })} />
          <Textarea className="sm:col-span-2" placeholder="Reason (required, audited)" value={result.reason} onChange={(e) => setResult({ ...result, reason: e.target.value })} />
        </div>
        <Button
          className="mt-3"
          variant="secondary"
          disabled={result.reason.trim().length < 3}
          onClick={() =>
            run(
              () =>
                api.post(`/matches/${match.id}/result`, {
                  resultType: result.resultType,
                  reason: result.reason,
                  resultText: result.resultText || undefined,
                  ...(result.resultType === 'WIN' ? { winnerTeamId: result.winnerTeamId, winMargin: result.winMargin ? +result.winMargin : undefined, winMarginType: result.winMarginType } : {}),
                }),
              'Result saved',
            )
          }
        >
          Save result
        </Button>
      </Card>

      <Card title="Danger zone">
        <div className="flex flex-wrap gap-2">
          {!['COMPLETED', 'CANCELLED'].includes(match.status) && (
            <ConfirmButton title="Cancel match?" reason="optional" onConfirm={(r) => run(() => api.post(`/matches/${match.id}/cancel`, { reason: r || undefined }), 'Match cancelled')}>
              Cancel match
            </ConfirmButton>
          )}
          <ConfirmButton
            title="Delete match?"
            message="The match is removed from listings and statistics are recalculated."
            onConfirm={async () => {
              await api.del(`/matches/${match.id}`);
              toast('Match deleted');
              nav('/matches');
            }}
          >
            Delete match
          </ConfirmButton>
        </div>
      </Card>
    </div>
  );
}
