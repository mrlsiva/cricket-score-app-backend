import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { BallChip, LiveView } from '../components/match/LiveView';
import { UserPicker } from '../components/pickers';
import { Badge, Button, Card, Checkbox, ConfirmButton, cx, Empty, enumOptions, ErrorBox, errText, Field, Input, Loading, Modal, PageHeader, Select, useToast } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useLiveMatch } from '../lib/live';
import { offlineQueue } from '../lib/offline';
import { Any, Match, Snapshot } from '../lib/types';

type Extra = 'NONE' | 'WIDE' | 'NO_BALL' | 'BYE' | 'LEG_BYE';
const EXTRAS: { value: Extra; label: string }[] = [
  { value: 'NONE', label: 'Normal' },
  { value: 'WIDE', label: 'Wide' },
  { value: 'NO_BALL', label: 'No ball' },
  { value: 'BYE', label: 'Bye' },
  { value: 'LEG_BYE', label: 'Leg bye' },
];
const WICKETS_FOR: Record<Extra, string[]> = {
  NONE: ['BOWLED', 'CAUGHT', 'LBW', 'RUN_OUT', 'STUMPED', 'HIT_WICKET'],
  WIDE: ['STUMPED', 'RUN_OUT', 'HIT_WICKET'],
  NO_BALL: ['RUN_OUT'],
  BYE: ['RUN_OUT'],
  LEG_BYE: ['RUN_OUT'],
};

interface Pl {
  id: string;
  name: string;
}

interface Crease {
  strikerId: string | null;
  nonStrikerId: string | null;
  bowlerId: string | null;
  ballsInOver: number;
}

/** Client-side mirror of the server's strike-rotation rules, used only while offline. */
function nextCrease(c: Crease, ball: Record<string, Any>, ballsPerOver: number): Crease {
  let { strikerId: s, nonStrikerId: ns, bowlerId: b, ballsInOver } = c;
  const extra: Extra = ball.extraType ?? 'NONE';
  const ran = ball.isBoundary ? 0 : ball.runs;
  if (ran % 2 === 1) [s, ns] = [ns, s];
  if (ball.wicketType) {
    const victim = ball.dismissedPlayerId ?? c.strikerId;
    if (s === victim) s = null;
    else if (ns === victim) ns = null;
  }
  if (extra === 'NONE' || extra === 'BYE' || extra === 'LEG_BYE') ballsInOver++;
  if (ballsInOver >= ballsPerOver) {
    [s, ns] = [ns, s];
    b = null;
    ballsInOver = 0;
  }
  return { strikerId: s, nonStrikerId: ns, bowlerId: b, ballsInOver };
}

function PlayerSelect({ label, players, value, onChange, exclude = [] }: { label: string; players: Pl[]; value: string; onChange: (v: string) => void; exclude?: string[] }) {
  return (
    <Field label={label}>
      <Select placeholder="Select…" options={players.filter((p) => !exclude.includes(p.id) || p.id === value).map((p) => ({ value: p.id, label: p.name }))} value={value} onChange={(e) => onChange(e.target.value)} />
    </Field>
  );
}

/** Opening selection for match start / next innings / super over. */
function StartInnings({ title, batting, bowling, onStart, busy, note }: { title: string; batting: Pl[]; bowling: Pl[]; onStart: (b: { strikerId: string; nonStrikerId: string; bowlerId: string }) => void; busy: boolean; note?: string }) {
  const [s, setS] = useState('');
  const [ns, setNs] = useState('');
  const [b, setB] = useState('');
  return (
    <Card title={title}>
      {note && <p className="mb-3 text-sm text-slate-500">{note}</p>}
      {batting.length < 2 ? (
        <Empty title="Squads are not set">Set playing XIs on the match page (Squads tab) first, or they default to team rosters.</Empty>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-3">
            <PlayerSelect label="Striker" players={batting} value={s} onChange={setS} exclude={[ns]} />
            <PlayerSelect label="Non-striker" players={batting} value={ns} onChange={setNs} exclude={[s]} />
            <PlayerSelect label="Opening bowler" players={bowling} value={b} onChange={setB} />
          </div>
          <Button className="mt-4" size="lg" disabled={!s || !ns || !b} loading={busy} onClick={() => onStart({ strikerId: s, nonStrikerId: ns, bowlerId: b })}>
            Start
          </Button>
        </>
      )}
    </Card>
  );
}

export default function ScoringPage() {
  const { id = '' } = useParams();
  const qc = useQueryClient();
  const toast = useToast();
  const { user } = useAuth();
  const { data: match, isLoading, error } = useQuery({ queryKey: ['match', id], queryFn: () => api.get<Match>(`/matches/${id}`) });
  const { data: scorer, refetch: refetchScorer } = useQuery({ queryKey: ['scorer', id], queryFn: () => api.get<Any>(`/matches/${id}/scorer`) });
  const { data: initial } = useQuery({ queryKey: ['live', id], queryFn: () => api.get<Snapshot>(`/matches/${id}/live`) });
  const { snapshot } = useLiveMatch(id);
  const [local, setLocal] = useState<Snapshot | null>(null);
  const snap = local && (!snapshot || local.updatedAt > snapshot.updatedAt) ? local : (snapshot ?? initial);
  const cur = snap?.current;
  const { data: card } = useQuery({ queryKey: ['scorecard', id], queryFn: () => api.get<Any>(`/matches/${id}/scorecard`), enabled: !!cur });
  const { data: balls, refetch: refetchBalls } = useQuery({
    queryKey: ['balls', id, cur?.inningsNumber],
    queryFn: () => api.get<Any[]>(`/matches/${id}/balls`, { inningsNumber: cur?.inningsNumber }),
    enabled: !!cur,
  });

  const [extra, setExtra] = useState<Extra>('NONE');
  const [nbType, setNbType] = useState<'BAT' | 'BYE' | 'LEG_BYE'>('BAT');
  const [busy, setBusy] = useState(false);
  const [wicketOpen, setWicketOpen] = useState(false);
  const [modal, setModal] = useState<null | 'batter' | 'bowler' | 'penalty' | 'retire' | 'transfer'>(null);
  const [editBall, setEditBall] = useState<Any>(null);
  const [online, setOnline] = useState(navigator.onLine);
  const [queue, setQueue] = useState(() => offlineQueue.list(id));

  useEffect(() => {
    const up = () => setOnline(true);
    const down = () => setOnline(false);
    window.addEventListener('online', up);
    window.addEventListener('offline', down);
    return () => {
      window.removeEventListener('online', up);
      window.removeEventListener('offline', down);
    };
  }, []);

  const squad = useCallback(
    (teamId?: string): Pl[] => {
      if (!match || !teamId) return [];
      const list = teamId === match.teamAId ? match.squads.teamA : match.squads.teamB;
      return list.map((m: Any) => ({ id: m.player.id, name: m.player.name }));
    },
    [match],
  );
  const inn = card?.innings?.find((i: Any) => i.number === cur?.inningsNumber);
  const outIds: string[] = useMemo(() => (inn?.batting ?? []).filter((b: Any) => b.isOut).map((b: Any) => b.playerId), [inn]);

  const after = (s: Any) => {
    if (s?.snapshot) setLocal(s.snapshot);
    else if (s?.match) setLocal(s);
    qc.invalidateQueries({ queryKey: ['scorecard', id] });
    qc.invalidateQueries({ queryKey: ['match', id] });
    refetchBalls();
  };
  const call = async (fn: () => Promise<Any>, ok?: string) => {
    setBusy(true);
    try {
      const r = await fn();
      after(r);
      if (ok) toast(ok);
      return r;
    } catch (e) {
      toast(errText(e), 'err');
    } finally {
      setBusy(false);
    }
  };

  // ── offline crease: while offline the server can't rotate strike, so track it locally ──
  const [crease, setCrease] = useState<Crease | null>(null);
  useEffect(() => {
    if (online) setCrease(null);
    else if (!crease && cur)
      setCrease({
        strikerId: cur.striker?.id ?? null,
        nonStrikerId: cur.nonStriker?.id ?? null,
        bowlerId: cur.bowler?.isCurrent ? cur.bowler.id : null,
        ballsInOver: Number(String(cur.overs).split('.')[1] ?? 0),
      });
  }, [online, cur, crease]);

  // ── offline-aware ball submit ──
  const submitBall = async (body: Record<string, Any>) => {
    const ball = { id: crypto.randomUUID(), ...body };
    if (!online && crease) {
      const q = offlineQueue.push(id, {
        ...ball,
        runs: body.runs,
        inningsNumber: cur!.inningsNumber,
        clientCreatedAt: new Date().toISOString(),
        strikerId: crease.strikerId ?? undefined,
        nonStrikerId: crease.nonStrikerId ?? undefined,
        bowlerId: crease.bowlerId ?? undefined,
      });
      setCrease(nextCrease(crease, body, match?.ballsPerOver ?? 6));
      setQueue(offlineQueue.list(id));
      toast(`Saved offline (#${q.clientSequence}). Sync when back online.`, 'info');
      return;
    }
    setBusy(true);
    try {
      const r = await api.post<Any>(`/matches/${id}/balls`, ball);
      after(r);
      setExtra('NONE');
      if (r.inningsEnded) toast(`Innings ended: ${r.endReason?.replace(/_/g, ' ').toLowerCase()}`, 'info');
    } catch (e) {
      if (e instanceof TypeError) {
        setOnline(false);
        toast('Connection lost — switched to offline mode', 'err');
      } else toast(errText(e), 'err');
    } finally {
      setBusy(false);
    }
  };

  const sync = async () => {
    const list = offlineQueue.list(id);
    if (!list.length) return;
    setBusy(true);
    try {
      const r = await api.post<Any>(`/matches/${id}/balls/sync`, { balls: list });
      offlineQueue.remove(
        id,
        r.results.filter((x: Any) => x.status === 'CREATED' || x.status === 'DUPLICATE').map((x: Any) => x.id),
      );
      setQueue(offlineQueue.list(id));
      after(r);
      const rej = r.results.find((x: Any) => x.status === 'REJECTED');
      toast(rej ? `Synced ${r.created}; stopped at #${rej.clientSequence}: ${rej.error}` : `Synced ${r.created} balls (${r.duplicates} duplicates)`, rej ? 'err' : 'ok');
    } catch (e) {
      toast(errText(e), 'err');
    } finally {
      setBusy(false);
    }
  };

  if (isLoading) return <Loading />;
  if (error || !match) return <ErrorBox error={error} />;

  const status = snap?.match.status ?? match.status;
  const isScorer = !!scorer?.isMe;
  const pending = scorer?.pendingTransfer;
  const lastInn = match.innings.at(-1);

  // ── lock / viewer mode ──
  const lockPanel = (
    <Card title="Scorer lock" actions={<Badge tone={isScorer ? 'green' : 'gray'}>{isScorer ? 'You are scoring' : 'Viewer mode'}</Badge>}>
      <p className="text-sm text-slate-600">
        Active scorer: <b>{scorer?.scorer?.name ?? 'nobody'}</b>. Only one device can score a match.
      </p>
      {pending && (
        <div className="mt-2 rounded-lg bg-yellow-50 p-2 text-sm">
          Pending transfer: {pending.fromUser?.name} → <b>{pending.toUser?.name}</b>
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        {!scorer?.scorer && (
          <Button size="sm" onClick={() => call(() => api.post(`/matches/${id}/scorer/claim`), 'Scorer lock acquired').then(() => refetchScorer())}>
            Claim scorer lock
          </Button>
        )}
        {pending && !isScorer && pending.toUserId === user?.id && (
          <>
            <Button size="sm" onClick={() => call(() => api.post(`/scorer/transfers/${pending.id}/accept`), 'You are now the scorer').then(() => refetchScorer())}>
              Accept transfer
            </Button>
            <Button size="sm" variant="secondary" onClick={() => call(() => api.post(`/scorer/transfers/${pending.id}/reject`)).then(() => refetchScorer())}>
              Reject
            </Button>
          </>
        )}
        {isScorer && (
          <>
            <Button size="sm" variant="secondary" onClick={() => setModal('transfer')}>
              Transfer scoring
            </Button>
            {pending && (
              <Button size="sm" variant="ghost" onClick={() => call(() => api.post(`/scorer/transfers/${pending.id}/cancel`), 'Transfer cancelled').then(() => refetchScorer())}>
                Cancel pending transfer
              </Button>
            )}
            <Button size="sm" variant="ghost" onClick={() => call(() => api.post(`/matches/${id}/scorer/release`), 'Lock released').then(() => refetchScorer())}>
              Release lock
            </Button>
          </>
        )}
      </div>
    </Card>
  );

  const header = (
    <PageHeader
      back={`/matches/${id}`}
      title={`${match.teamA.name} vs ${match.teamB.name}`}
      subtitle={`Scoring console · ${match.overs} overs`}
      actions={
        <div className="flex items-center gap-2">
          <Badge tone={online ? 'green' : 'red'}>{online ? 'Online' : 'Offline'}</Badge>
          <Checkbox label="Offline mode" checked={!online} onChange={(v) => setOnline(!v)} />
        </div>
      }
    />
  );

  // ── pre-play states ──
  if (status === 'SCHEDULED')
    return (
      <div className="space-y-4">
        {header}
        <Empty title="Record the toss first">
          <Link className="text-pitch-600 underline" to={`/matches/${id}?tab=manage`}>
            Open match → Manage → Toss
          </Link>
        </Empty>
      </div>
    );

  if (status === 'TOSS_COMPLETED') {
    const batId = match.tossDecision === 'BAT' ? match.tossWinnerId! : match.tossWinnerId === match.teamAId ? match.teamBId : match.teamAId;
    const bowlId = batId === match.teamAId ? match.teamBId : match.teamAId;
    return (
      <div className="space-y-4">
        {header}
        <StartInnings
          title="Start match"
          note={`${match.tossText}. Starting acquires the scorer lock for you.`}
          batting={squad(batId)}
          bowling={squad(bowlId)}
          busy={busy}
          onStart={(b) => call(() => api.post(`/matches/${id}/start`, b), 'Match started').then(() => refetchScorer())}
        />
        {lockPanel}
      </div>
    );
  }

  if (!isScorer)
    return (
      <div className="space-y-4">
        {header}
        {lockPanel}
        <LiveView snap={snap} />
      </div>
    );

  if (status === 'INNINGS_BREAK' && lastInn) {
    const batId = lastInn.battingTeamId === match.teamAId ? match.teamBId : match.teamAId;
    return (
      <div className="space-y-4">
        {header}
        <StartInnings
          title={`Innings break · ${batId === match.teamAId ? match.teamA.name : match.teamB.name} need ${lastInn.runs + 1}`}
          batting={squad(batId)}
          bowling={squad(lastInn.battingTeamId)}
          busy={busy}
          onStart={(b) => call(() => api.post(`/matches/${id}/innings`, b), 'Innings started')}
        />
        <LiveView snap={snap} />
        {lockPanel}
      </div>
    );
  }

  if (status === 'COMPLETED' || status === 'CANCELLED')
    return (
      <div className="space-y-4">
        {header}
        <Card title="Match finished">
          <p className="font-semibold text-pitch-700">{match.resultText}</p>
          <div className="mt-3 flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => call(() => api.post(`/matches/${id}/balls/undo`, { reason: 'Reopen match' }), 'Last ball undone — match reopened')}>
              ↶ Undo last ball (reopen)
            </Button>
            <Link to={`/matches/${id}?tab=scorecard`}>
              <Button>View scorecard</Button>
            </Link>
          </div>
        </Card>
        {match.resultType === 'TIE' && lastInn && (
          <StartInnings
            title="Super over"
            note="The team that batted second bats first."
            batting={squad(lastInn.battingTeamId)}
            bowling={squad(lastInn.battingTeamId === match.teamAId ? match.teamBId : match.teamAId)}
            busy={busy}
            onStart={(b) => call(() => api.post(`/matches/${id}/super-over`, b), 'Super over started')}
          />
        )}
      </div>
    );

  if (!cur) return <Loading />;
  const battingSquad = squad(cur.battingTeamId);
  const bowlingSquad = squad(cur.bowlingTeamId);
  const atCrease = [cur.striker?.id, cur.nonStriker?.id].filter(Boolean) as string[];
  const offline = !online && !!crease;
  const needBat = offline ? !crease!.strikerId || !crease!.nonStrikerId : cur.needsNewBatsman;
  const needBowl = offline ? !crease!.bowlerId : cur.needsNewBowler;
  const blocked = needBat || needBowl || snap!.match.isPaused;
  const nameOf = (pid?: string | null) => [...battingSquad, ...bowlingSquad].find((p) => p.id === pid)?.name ?? '—';

  return (
    <div className="space-y-4">
      {header}

      {/* compact scoreboard */}
      <div className="rounded-2xl bg-pitch-800 p-4 text-white shadow">
        <div className="flex flex-wrap items-end justify-between gap-2">
          <div>
            <div className="text-4xl font-extrabold tabular">{cur.score}</div>
            <div className="text-sm text-white/75 tabular">
              {cur.overs}/{cur.maxOvers} ov · CRR {cur.runRate}
              {cur.target ? ` · ${cur.equation}` : ''}
            </div>
          </div>
          <div className="text-right text-sm tabular">
            {[cur.striker, cur.nonStriker].map((b, i) => (
              <div key={i}>
                {b ? (
                  <>
                    {b.name}
                    {i === 0 && <span className="text-gold"> *</span>} <b>{b.runs}</b>({b.balls})
                  </>
                ) : (
                  <span className="text-gold">— new batter —</span>
                )}
              </div>
            ))}
            <div className="mt-1 text-white/75">
              {cur.bowler?.isCurrent ? `${cur.bowler.name} ${cur.bowler.overs}-${cur.bowler.maidens}-${cur.bowler.runs}-${cur.bowler.wickets}` : <span className="text-gold">— select bowler —</span>}
            </div>
          </div>
        </div>
        <div className="mt-3 flex min-h-9 flex-wrap gap-1.5">
          {cur.thisOver.map((s, i) => (
            <BallChip key={i} s={s} big />
          ))}
        </div>
      </div>

      {snap!.match.isPaused && (
        <div className="flex items-center justify-between rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
          ⏸ Match paused
          <Button size="sm" onClick={() => call(() => api.post(`/matches/${id}/resume`, {}), 'Resumed')}>
            Resume
          </Button>
        </div>
      )}
      {offline && (
        <div className="rounded-xl bg-slate-800 p-3 text-sm text-white">
          Offline crease: <b>{nameOf(crease!.strikerId)}*</b> / {nameOf(crease!.nonStrikerId)} · bowler {nameOf(crease!.bowlerId)} · ball {crease!.ballsInOver} of over
        </div>
      )}
      {needBat && !snap!.match.isPaused && (
        <div className="flex items-center justify-between rounded-xl bg-yellow-50 p-3 text-sm">
          Wicket fell — choose the new batter
          <Button size="sm" variant="gold" onClick={() => setModal('batter')}>
            Select batter
          </Button>
        </div>
      )}
      {!needBat && needBowl && !snap!.match.isPaused && (
        <div className="flex items-center justify-between rounded-xl bg-yellow-50 p-3 text-sm">
          Over complete — choose the next bowler
          <Button size="sm" variant="gold" onClick={() => setModal('bowler')}>
            Select bowler
          </Button>
        </div>
      )}

      {/* scoring pad */}
      <Card>
        <div className="mb-3 flex flex-wrap gap-2">
          {EXTRAS.map((e) => (
            <button
              key={e.value}
              onClick={() => setExtra(e.value)}
              className={cx('rounded-full border px-3 py-1.5 text-sm font-semibold', extra === e.value ? 'border-pitch-600 bg-pitch-600 text-white' : 'border-slate-300 bg-white text-slate-600')}
            >
              {e.label}
            </button>
          ))}
          {extra === 'NO_BALL' && <Select className="max-w-[170px]" options={[{ value: 'BAT', label: 'Runs off bat' }, { value: 'BYE', label: 'Byes' }, { value: 'LEG_BYE', label: 'Leg byes' }]} value={nbType} onChange={(e) => setNbType(e.target.value as 'BAT')} />}
        </div>
        <div className="grid grid-cols-4 gap-2 sm:grid-cols-8">
          {[0, 1, 2, 3, 4, 5, 6].map((r) => (
            <button
              key={r}
              disabled={busy || blocked}
              onClick={() => submitBall({ runs: r, extraType: extra, noBallRunsType: extra === 'NO_BALL' ? nbType : undefined, isBoundary: r === 4 || r === 6 ? true : undefined })}
              className={cx(
                'h-16 rounded-2xl text-2xl font-extrabold shadow-sm transition active:scale-95 disabled:opacity-40',
                r === 4 ? 'bg-sky-600 text-white' : r === 6 ? 'bg-violet-600 text-white' : 'bg-slate-100 text-slate-800 hover:bg-slate-200',
              )}
            >
              {r}
              {extra !== 'NONE' && <span className="block text-[10px] font-semibold uppercase">{EXTRAS.find((e) => e.value === extra)!.label}</span>}
            </button>
          ))}
          <button disabled={busy || blocked} onClick={() => setWicketOpen(true)} className="h-16 rounded-2xl bg-ball text-xl font-extrabold text-white shadow-sm active:scale-95 disabled:opacity-40">
            OUT
          </button>
        </div>
        <p className="mt-2 text-xs text-slate-400">Pick an extra type first (Wide, No ball…), then the runs. "4" and "6" are recorded as boundaries.</p>

        <div className="mt-4 flex flex-wrap gap-2 border-t border-slate-100 pt-4">
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => call(() => api.post(`/matches/${id}/balls/undo`, {}), 'Last ball undone')}>
            ↶ Undo
          </Button>
          <Button variant="secondary" size="sm" disabled={busy} onClick={() => call(() => api.post(`/matches/${id}/strike/swap`))}>
            ⇄ Swap strike
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setModal('batter')}>
            Change batters
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setModal('bowler')}>
            Change bowler
          </Button>
          <Button variant="secondary" size="sm" disabled={busy || !cur.thisOver.length} onClick={() => call(() => api.post(`/matches/${id}/over/end`), 'Over ended')}>
            End over
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setModal('penalty')}>
            Penalty
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setModal('retire')}>
            Retired hurt / timed out
          </Button>
          {snap!.match.isPaused ? (
            <Button variant="secondary" size="sm" onClick={() => call(() => api.post(`/matches/${id}/resume`, {}), 'Resumed')}>
              ▶ Resume
            </Button>
          ) : (
            <ConfirmButton variant="secondary" title="Pause match" reason="optional" confirmText="Pause" onConfirm={(r) => call(() => api.post(`/matches/${id}/pause`, { reason: r || undefined }), 'Paused')}>
              ⏸ Pause
            </ConfirmButton>
          )}
          <ConfirmButton title="End innings now?" message="Use for declarations or shortened innings." reason="optional" onConfirm={(r) => call(() => api.post(`/matches/${id}/innings/end`, { reason: r || undefined }), 'Innings ended')}>
            End innings
          </ConfirmButton>
        </div>
      </Card>

      {!!queue.length && (
        <Card title={`Offline queue (${queue.length})`} actions={<Button size="sm" disabled={!online} loading={busy} onClick={sync}>Sync now</Button>}>
          <div className="flex flex-wrap gap-1.5">
            {queue.map((q) => (
              <BallChip key={q.id} s={q.wicketType ? 'W' : q.extraType && q.extraType !== 'NONE' ? `${q.runs}${q.extraType === 'WIDE' ? 'wd' : q.extraType === 'NO_BALL' ? 'nb' : 'b'}` : String(q.runs)} />
            ))}
          </div>
          <div className="mt-2 flex justify-between text-xs text-slate-500">
            <span>Each ball has a unique id, so syncing twice never duplicates.</span>
            <button
              className="text-ball"
              onClick={() => {
                if (confirm('Discard all unsynced balls?')) {
                  offlineQueue.clear(id);
                  setQueue([]);
                }
              }}
            >
              discard
            </button>
          </div>
        </Card>
      )}

      {lockPanel}

      <Card title={`Ball log · innings ${cur.inningsNumber}`}>
        {!balls?.length ? (
          <Empty title="No balls yet" />
        ) : (
          <div className="max-h-96 divide-y divide-slate-100 overflow-y-auto">
            {[...balls].reverse().map((b) => (
              <div key={b.id} className="flex items-center gap-3 py-2 text-sm">
                <span className="w-10 font-semibold tabular text-slate-500">{b.kind === 'DELIVERY' ? `${b.overNumber}.${b.ballInOver}` : '—'}</span>
                <BallChip
                  s={
                    b.kind === 'PENALTY'
                      ? `${b.extraRuns}P`
                      : b.kind === 'OVER_END'
                        ? '|'
                        : b.isWicket
                          ? 'W'
                          : b.extraType === 'WIDE'
                            ? 'wd'
                            : b.extraType === 'NO_BALL'
                              ? `${b.runsOffBat || ''}nb`
                              : b.extraType === 'BYE' || b.extraType === 'LEG_BYE'
                                ? `${b.extraRuns}${b.extraType === 'BYE' ? 'b' : 'lb'}`
                                : String(b.runsOffBat)
                  }
                />
                <span className="flex-1 truncate text-xs text-slate-500">
                  {[...battingSquad, ...bowlingSquad].find((p) => p.id === b.bowlerId)?.name} → {battingSquad.find((p) => p.id === b.batsmanId)?.name}
                  {b.wicketType ? ` · ${b.wicketType.replace('_', ' ').toLowerCase()}` : ''} · {b.scoreAfter}/{b.wicketsAfter}
                </span>
                {b.kind === 'DELIVERY' && (
                  <button className="text-xs text-pitch-600 hover:underline" onClick={() => setEditBall(b)}>
                    edit
                  </button>
                )}
                <ConfirmButton variant="ghost" size="sm" title="Delete this ball?" reason="required" onConfirm={(r) => call(() => api.del(`/matches/${id}/balls/${b.id}`, { reason: r }), 'Ball deleted')}>
                  ✕
                </ConfirmButton>
              </div>
            ))}
          </div>
        )}
      </Card>

      {wicketOpen && (
        <WicketModal
          extra={extra}
          striker={cur.striker}
          nonStriker={cur.nonStriker}
          fielders={bowlingSquad}
          bowlerId={cur.bowler?.id}
          onClose={() => setWicketOpen(false)}
          onSubmit={(b) => {
            setWicketOpen(false);
            submitBall({ ...b, extraType: extra });
          }}
        />
      )}
      {modal === 'batter' && (
        <BattersModal
          squad={battingSquad}
          out={outIds}
          striker={(offline ? crease!.strikerId : cur.striker?.id) ?? ''}
          nonStriker={(offline ? crease!.nonStrikerId : cur.nonStriker?.id) ?? ''}
          onClose={() => setModal(null)}
          onSave={(b) =>
            offline
              ? (setCrease({ ...crease!, strikerId: b.strikerId, nonStrikerId: b.nonStrikerId }), setModal(null))
              : call(() => api.post(`/matches/${id}/batsmen`, b)).then((r) => r && setModal(null))
          }
        />
      )}
      {modal === 'bowler' && (
        <BowlerModal
          squad={bowlingSquad}
          previous={cur.previousBowlerId ?? undefined}
          onClose={() => setModal(null)}
          onSave={(b) =>
            offline ? (setCrease({ ...crease!, bowlerId: b.bowlerId }), setModal(null)) : call(() => api.post(`/matches/${id}/bowler`, b)).then((r) => r && setModal(null))
          }
        />
      )}
      {modal === 'penalty' && <PenaltyModal onClose={() => setModal(null)} onSave={(b) => call(() => api.post(`/matches/${id}/penalty`, b), 'Penalty runs added').then((r) => r && setModal(null))} />}
      {modal === 'retire' && (
        <Modal open onClose={() => setModal(null)} title="Non-delivery dismissal">
          <div className="space-y-2">
            {atCrease.map((pid) => (
              <div key={pid} className="flex items-center justify-between rounded-lg bg-slate-50 p-2 text-sm">
                {battingSquad.find((p) => p.id === pid)?.name}
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => call(() => api.post(`/matches/${id}/dismissal`, { playerId: pid, wicketType: 'RETIRED_HURT' }), 'Retired hurt').then(() => setModal(null))}>
                    Retired hurt
                  </Button>
                  <Button size="sm" variant="danger" onClick={() => call(() => api.post(`/matches/${id}/dismissal`, { playerId: pid, wicketType: 'TIMED_OUT' }), 'Timed out').then(() => setModal(null))}>
                    Timed out
                  </Button>
                </div>
              </div>
            ))}
            <p className="text-xs text-slate-400">Retired hurt is not a wicket; the batter may return later via "Change batters".</p>
          </div>
        </Modal>
      )}
      {modal === 'transfer' && (
        <Modal open onClose={() => setModal(null)} title="Transfer scoring">
          <p className="mb-3 text-sm text-slate-500">The other user must accept (within 5 minutes). Until then you keep scoring.</p>
          <UserPicker
            onPick={(u) =>
              call(() => api.post(`/matches/${id}/scorer/transfer`, { toUserId: u.id }), `Request sent to ${u.name}`).then(() => {
                setModal(null);
                refetchScorer();
              })
            }
          />
        </Modal>
      )}
      {editBall && <EditBallModal ball={editBall} batting={battingSquad} bowling={bowlingSquad} onClose={() => setEditBall(null)} onSave={(b) => call(() => api.patch(`/matches/${id}/balls/${editBall.id}`, b), 'Ball updated').then((r) => r && setEditBall(null))} />}
    </div>
  );
}

// ─────────────── modals ───────────────

function WicketModal({ extra, striker, nonStriker, fielders, bowlerId, onClose, onSubmit }: { extra: Extra; striker: Any; nonStriker: Any; fielders: Pl[]; bowlerId?: string; onClose: () => void; onSubmit: (b: Record<string, Any>) => void }) {
  const types = WICKETS_FOR[extra];
  const [type, setType] = useState(types[0]);
  const [dismissed, setDismissed] = useState(striker?.id ?? '');
  const [fielder, setFielder] = useState('');
  const [runs, setRuns] = useState(0);
  const needsFielder = ['CAUGHT', 'RUN_OUT', 'STUMPED'].includes(type);
  return (
    <Modal
      open
      onClose={onClose}
      title={`Wicket${extra !== 'NONE' ? ` (${extra.replace('_', ' ').toLowerCase()})` : ''}`}
      footer={
        <Button variant="danger" disabled={type === 'CAUGHT' && !fielder} onClick={() => onSubmit({ runs, wicketType: type, dismissedPlayerId: type === 'RUN_OUT' ? dismissed : undefined, fielderId: needsFielder && fielder ? fielder : undefined })}>
          Confirm wicket
        </Button>
      }
    >
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {types.map((t) => (
          <button key={t} onClick={() => setType(t)} className={cx('rounded-xl border px-3 py-3 text-sm font-semibold', type === t ? 'border-ball bg-red-50 text-ball' : 'border-slate-200')}>
            {t.replace('_', ' ').toLowerCase().replace(/\b\w/g, (c) => c.toUpperCase())}
          </button>
        ))}
      </div>
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        {type === 'RUN_OUT' && (
          <Field label="Who is out?">
            <Select
              options={[striker, nonStriker].filter(Boolean).map((p: Any, i: number) => ({ value: p.id, label: `${p.name}${i === 0 ? ' (striker)' : ''}` }))}
              value={dismissed}
              onChange={(e) => setDismissed(e.target.value)}
            />
          </Field>
        )}
        {needsFielder && (
          <Field label={type === 'STUMPED' ? 'Wicket keeper' : type === 'CAUGHT' ? 'Caught by (bowler = c&b)' : 'Fielder'}>
            <Select placeholder="Select…" options={fielders.map((p) => ({ value: p.id, label: `${p.name}${p.id === bowlerId ? ' (bowler)' : ''}` }))} value={fielder} onChange={(e) => setFielder(e.target.value)} />
          </Field>
        )}
        {(type === 'RUN_OUT' || extra !== 'NONE') && (
          <Field label="Runs completed">
            <Input type="number" min={0} max={6} value={runs} onChange={(e) => setRuns(+e.target.value)} />
          </Field>
        )}
      </div>
    </Modal>
  );
}

function BattersModal({ squad, out, striker, nonStriker, onClose, onSave }: { squad: Pl[]; out: string[]; striker: string; nonStriker: string; onClose: () => void; onSave: (b: Any) => void }) {
  const [s, setS] = useState(striker);
  const [ns, setNs] = useState(nonStriker);
  const avail = squad.filter((p) => !out.includes(p.id));
  return (
    <Modal open onClose={onClose} title="Batters at the crease" footer={<Button disabled={!s || !ns || s === ns} onClick={() => onSave({ strikerId: s, nonStrikerId: ns })}>Save</Button>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <PlayerSelect label="Striker" players={avail} value={s} onChange={setS} exclude={[ns]} />
        <PlayerSelect label="Non-striker" players={avail} value={ns} onChange={setNs} exclude={[s]} />
      </div>
      {!!out.length && <p className="mt-2 text-xs text-slate-400">Dismissed batters are hidden.</p>}
    </Modal>
  );
}

function BowlerModal({ squad, previous, onClose, onSave }: { squad: Pl[]; previous?: string; onClose: () => void; onSave: (b: Any) => void }) {
  const [b, setB] = useState('');
  const [allow, setAllow] = useState(false);
  return (
    <Modal open onClose={onClose} title="Bowler" footer={<Button disabled={!b} onClick={() => onSave({ bowlerId: b, allowConsecutiveOvers: allow || undefined })}>Save</Button>}>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
        {squad.map((p) => (
          <button
            key={p.id}
            disabled={p.id === previous && !allow}
            onClick={() => setB(p.id)}
            className={cx('rounded-xl border px-3 py-3 text-sm font-semibold disabled:opacity-40', b === p.id ? 'border-pitch-600 bg-pitch-50 text-pitch-700' : 'border-slate-200')}
          >
            {p.name}
            {p.id === previous && <span className="block text-[10px] font-normal">bowled last over</span>}
          </button>
        ))}
      </div>
      <div className="mt-3">
        <Checkbox label="Allow consecutive overs (local rules)" checked={allow} onChange={setAllow} />
      </div>
    </Modal>
  );
}

function PenaltyModal({ onClose, onSave }: { onClose: () => void; onSave: (b: Any) => void }) {
  const [runs, setRuns] = useState(5);
  const [reason, setReason] = useState('');
  return (
    <Modal open onClose={onClose} title="Penalty runs (batting side)" footer={<Button disabled={reason.trim().length < 3} onClick={() => onSave({ runs, reason })}>Award</Button>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Runs">
          <Input type="number" min={1} max={10} value={runs} onChange={(e) => setRuns(+e.target.value)} />
        </Field>
        <Field label="Reason">
          <Input value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ball hit helmet" />
        </Field>
      </div>
    </Modal>
  );
}

function EditBallModal({ ball, batting, bowling, onClose, onSave }: { ball: Any; batting: Pl[]; bowling: Pl[]; onClose: () => void; onSave: (b: Any) => void }) {
  const initialRuns = ball.extraType === 'WIDE' ? Math.max(0, ball.extraRuns - 1) : ball.extraType === 'BYE' || ball.extraType === 'LEG_BYE' ? ball.extraRuns : ball.runsOffBat;
  const [v, setV] = useState<Record<string, Any>>({
    runs: initialRuns,
    extraType: ball.extraType,
    wicketType: ball.wicketType ?? '',
    dismissedPlayerId: ball.dismissedPlayerId ?? '',
    fielderId: ball.fielderId ?? '',
    batsmanId: ball.batsmanId,
    nonStrikerId: ball.nonStrikerId,
    bowlerId: ball.bowlerId,
    reason: '',
  });
  const set = (k: string, val: Any) => setV((s) => ({ ...s, [k]: val }));
  const wicketTypes = WICKETS_FOR[v.extraType as Extra] ?? [];
  const save = () =>
    onSave({
      runs: v.runs,
      extraType: v.extraType,
      wicketType: v.wicketType || null,
      dismissedPlayerId: v.wicketType ? v.dismissedPlayerId || undefined : undefined,
      fielderId: v.wicketType && v.fielderId ? v.fielderId : undefined,
      batsmanId: v.batsmanId,
      nonStrikerId: v.nonStrikerId,
      bowlerId: v.bowlerId,
      reason: v.reason,
    });
  return (
    <Modal open onClose={onClose} wide title={`Edit ball ${ball.overNumber}.${ball.ballInOver}`} footer={<Button disabled={v.reason.trim().length < 3} onClick={save}>Save (innings is recalculated)</Button>}>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Runs">
          <Input type="number" min={0} max={7} value={v.runs} onChange={(e) => set('runs', +e.target.value)} />
        </Field>
        <Field label="Extra">
          <Select options={EXTRAS} value={v.extraType} onChange={(e) => set('extraType', e.target.value)} />
        </Field>
        <Field label="Wicket">
          <Select placeholder="No wicket" options={enumOptions(wicketTypes)} value={v.wicketType} onChange={(e) => set('wicketType', e.target.value)} />
        </Field>
        <PlayerSelect label="Batter" players={batting} value={v.batsmanId} onChange={(x) => set('batsmanId', x)} />
        <PlayerSelect label="Non-striker" players={batting} value={v.nonStrikerId} onChange={(x) => set('nonStrikerId', x)} />
        <PlayerSelect label="Bowler" players={bowling} value={v.bowlerId} onChange={(x) => set('bowlerId', x)} />
        {v.wicketType && (
          <>
            <PlayerSelect label="Dismissed" players={batting.filter((p) => [v.batsmanId, v.nonStrikerId].includes(p.id))} value={v.dismissedPlayerId} onChange={(x) => set('dismissedPlayerId', x)} />
            <PlayerSelect label="Fielder" players={bowling} value={v.fielderId} onChange={(x) => set('fielderId', x)} />
          </>
        )}
        <Field label="Reason (audited)" className="sm:col-span-3">
          <Input value={v.reason} onChange={(e) => set('reason', e.target.value)} placeholder="Scorer correction" />
        </Field>
      </div>
    </Modal>
  );
}
