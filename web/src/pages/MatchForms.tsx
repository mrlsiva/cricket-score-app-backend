import { useQuery } from '@tanstack/react-query';
import { FormEvent, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { TeamSelect } from '../components/pickers';
import { Button, Card, Checkbox, enumOptions, errText, Field, Input, PageHeader, Select, useToast } from '../components/ui';
import { api } from '../lib/api';
import { Any, Match } from '../lib/types';

const BALL_TYPES = ['TENNIS', 'LEATHER', 'RUBBER', 'TAPE', 'OTHER'];
const PITCH_TYPES = ['TURF', 'MATTING', 'CEMENT', 'ASTRO_TURF', 'MUD', 'OTHER'];

/** Optional match settings shared by both forms. */
function OptionsFields({ v, set }: { v: Record<string, Any>; set: (k: string, val: Any) => void }) {
  return (
    <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
      <Field label="Ground">
        <Input value={v.ground ?? ''} onChange={(e) => set('ground', e.target.value)} placeholder="Marina Ground" />
      </Field>
      <Field label="Date & time">
        <Input type="datetime-local" value={v.scheduledAt ?? ''} onChange={(e) => set('scheduledAt', e.target.value)} />
      </Field>
      <Field label="Umpire">
        <Input value={v.umpireName ?? ''} onChange={(e) => set('umpireName', e.target.value)} />
      </Field>
      <Field label="Ball type">
        <Select placeholder="—" options={enumOptions(BALL_TYPES)} value={v.ballType ?? ''} onChange={(e) => set('ballType', e.target.value)} />
      </Field>
      <Field label="Pitch type">
        <Select placeholder="—" options={enumOptions(PITCH_TYPES)} value={v.pitchType ?? ''} onChange={(e) => set('pitchType', e.target.value)} />
      </Field>
      <Field label="Wide / no-ball runs" hint="Local formats sometimes use 0">
        <div className="flex gap-2">
          <Select options={[0, 1, 2].map((n) => ({ value: String(n), label: `Wd ${n}` }))} value={String(v.wideRuns ?? 1)} onChange={(e) => set('wideRuns', +e.target.value)} />
          <Select options={[0, 1, 2].map((n) => ({ value: String(n), label: `Nb ${n}` }))} value={String(v.noBallRuns ?? 1)} onChange={(e) => set('noBallRuns', +e.target.value)} />
        </div>
      </Field>
    </div>
  );
}

const clean = (o: Record<string, Any>) => {
  const out: Record<string, Any> = {};
  for (const [k, v] of Object.entries(o)) if (v !== '' && v !== undefined && v !== null) out[k] = v;
  if (out.scheduledAt) out.scheduledAt = new Date(out.scheduledAt).toISOString();
  return out;
};

export function QuickMatchPage() {
  const nav = useNavigate();
  const toast = useToast();
  const [v, setV] = useState<Record<string, Any>>({ teamAName: 'Team A', teamBName: 'Team B', playersPerTeam: 8, overs: 6, tossWinner: 'A', tossDecision: 'BAT', prefixA: 'T', prefixB: 'P' });
  const [namesA, setNamesA] = useState('');
  const [namesB, setNamesB] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (k: string, val: Any) => setV((s) => ({ ...s, [k]: val }));
  const split = (s: string) => s.split(/[\n,]/).map((x) => x.trim()).filter(Boolean);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const m = await api.post<Match>('/matches/quick', clean({ ...v, teamAPlayerNames: split(namesA), teamBPlayerNames: split(namesB) }));
      toast('Quick match created');
      nav(`/matches/${m.id}/score`);
    } catch (err) {
      toast(errText(err), 'err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <PageHeader title="⚡ Quick match" subtitle="No registration needed — players get placeholders (T1, T2… / P1, P2…) that can be renamed and claimed later." back="/matches" />
      <div className="space-y-4">
        <Card title="Teams">
          <div className="grid gap-4 sm:grid-cols-2">
            {(['A', 'B'] as const).map((s) => (
              <div key={s} className="space-y-3 rounded-xl bg-slate-50 p-3">
                <Field label={`Team ${s} name`}>
                  <Input required value={v[`team${s}Name`]} onChange={(e) => set(`team${s}Name`, e.target.value)} />
                </Field>
                <Field label="Placeholder prefix" hint={s === 'A' ? 'T → T1, T2… or BT → BT1…' : 'P → P1, P2… or BW → BW1…'}>
                  <Input value={v[`prefix${s}`]} maxLength={3} onChange={(e) => set(`prefix${s}`, e.target.value.toUpperCase().replace(/[^A-Z]/g, ''))} />
                </Field>
                <Field label="Player names (optional)" hint="Comma or line separated, in batting order">
                  <textarea
                    className="w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
                    rows={2}
                    value={s === 'A' ? namesA : namesB}
                    onChange={(e) => (s === 'A' ? setNamesA : setNamesB)(e.target.value)}
                  />
                </Field>
              </div>
            ))}
          </div>
        </Card>
        <Card title="Format & toss">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Players per team">
              <Input type="number" min={2} max={15} required value={v.playersPerTeam} onChange={(e) => set('playersPerTeam', +e.target.value)} />
            </Field>
            <Field label="Overs">
              <Input type="number" min={1} max={100} required value={v.overs} onChange={(e) => set('overs', +e.target.value)} />
            </Field>
            <Field label="Toss won by">
              <Select options={[{ value: 'A', label: v.teamAName || 'Team A' }, { value: 'B', label: v.teamBName || 'Team B' }]} value={v.tossWinner} onChange={(e) => set('tossWinner', e.target.value)} />
            </Field>
            <Field label="Elected to">
              <Select options={[{ value: 'BAT', label: 'Bat' }, { value: 'BOWL', label: 'Bowl' }]} value={v.tossDecision} onChange={(e) => set('tossDecision', e.target.value)} />
            </Field>
          </div>
        </Card>
        <Card title="Optional details">
          <OptionsFields v={v} set={set} />
        </Card>
        <Button size="lg" loading={busy} className="w-full sm:w-auto">
          Create & start scoring
        </Button>
      </div>
    </form>
  );
}

export function CreateMatchPage() {
  const nav = useNavigate();
  const toast = useToast();
  const [params] = useSearchParams();
  const [v, setV] = useState<Record<string, Any>>({
    tournamentId: params.get('tournamentId') ?? '',
    teamAId: '',
    teamBId: '',
    playersPerTeam: 11,
    overs: 20,
    tossWinnerId: '',
    tossDecision: 'BAT',
    fillWithTemporaryPlayers: true,
    name: '',
  });
  const [busy, setBusy] = useState(false);
  const set = (k: string, val: Any) => setV((s) => ({ ...s, [k]: val }));
  const { data: tournaments } = useQuery({ queryKey: ['my-tournaments'], queryFn: () => api.page<Any>('/tournaments', { mine: true, limit: 100 }) });
  const { data: teamsMeta } = useQuery({
    queryKey: ['team-names', v.teamAId, v.teamBId],
    queryFn: async () => Promise.all([v.teamAId, v.teamBId].map((id) => (id ? api.get<Any>(`/teams/${id}`) : null))),
  });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      const m = await api.post<Match>('/matches', clean(v));
      toast('Match created');
      nav(`/matches/${m.id}`);
    } catch (err) {
      toast(errText(err), 'err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit}>
      <PageHeader title="New match" subtitle="Registered teams. Squads default to each team's roster; set the playing XI on the match page." back="/matches" />
      <div className="space-y-4">
        <Card title="Teams">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Field label="Tournament (optional)">
              <Select
                placeholder="Friendly (no tournament)"
                options={(tournaments?.items ?? []).map((t) => ({ value: t.id, label: t.name }))}
                value={v.tournamentId}
                onChange={(e) => set('tournamentId', e.target.value)}
              />
            </Field>
            <Field label="Team A">
              <TeamSelect value={v.teamAId} onChange={(id) => set('teamAId', id)} tournamentId={v.tournamentId || undefined} />
            </Field>
            <Field label="Team B">
              <TeamSelect value={v.teamBId} onChange={(id) => set('teamBId', id)} tournamentId={v.tournamentId || undefined} />
            </Field>
            <Field label="Match name (optional)">
              <Input value={v.name} onChange={(e) => set('name', e.target.value)} />
            </Field>
          </div>
        </Card>
        <Card title="Format & toss">
          <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Field label="Players per team">
              <Input type="number" min={2} max={15} value={v.playersPerTeam} onChange={(e) => set('playersPerTeam', +e.target.value)} />
            </Field>
            <Field label="Overs">
              <Input type="number" min={1} max={100} value={v.overs} onChange={(e) => set('overs', +e.target.value)} />
            </Field>
            <Field label="Toss won by">
              <Select
                placeholder="Select"
                options={[v.teamAId, v.teamBId].filter(Boolean).map((id, i) => ({ value: id, label: teamsMeta?.[i]?.name ?? `Team ${i ? 'B' : 'A'}` }))}
                value={v.tossWinnerId}
                onChange={(e) => set('tossWinnerId', e.target.value)}
              />
            </Field>
            <Field label="Elected to">
              <Select options={[{ value: 'BAT', label: 'Bat' }, { value: 'BOWL', label: 'Bowl' }]} value={v.tossDecision} onChange={(e) => set('tossDecision', e.target.value)} />
            </Field>
          </div>
          <div className="mt-4">
            <Checkbox label="Fill missing players with temporary placeholders" checked={v.fillWithTemporaryPlayers} onChange={(c) => set('fillWithTemporaryPlayers', c)} />
          </div>
        </Card>
        <Card title="Optional details">
          <OptionsFields v={v} set={set} />
        </Card>
        <Button size="lg" loading={busy}>
          Create match
        </Button>
      </div>
    </form>
  );
}
