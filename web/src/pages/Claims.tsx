import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { PlayerPicker } from '../components/pickers';
import { Avatar, Badge, Button, Card, Empty, errText, Field, Input, Loading, PageHeader, Select, useToast } from '../components/ui';
import { api } from '../lib/api';
import { fmtAgo, label } from '../lib/format';
import { Any } from '../lib/types';

const TONE: Record<string, string> = { PENDING: 'amber', ACCEPTED: 'green', REJECTED: 'red', CANCELLED: 'gray' };

export default function ClaimsPage() {
  const qc = useQueryClient();
  const toast = useToast();
  const [message, setMessage] = useState('');
  const [status, setStatus] = useState('PENDING');
  const { data: mine } = useQuery({ queryKey: ['claims', 'mine'], queryFn: () => api.get<Any[]>('/players/claims/mine') });
  const { data: review, isLoading } = useQuery({ queryKey: ['claims', 'review', status], queryFn: () => api.page<Any>('/players/claims/review', { status, limit: 50 }) });
  const refresh = () => qc.invalidateQueries({ queryKey: ['claims'] });
  const request = useMutation({
    mutationFn: (temporaryPlayerId: string) => api.post('/players/claims', { temporaryPlayerId, message: message || undefined }),
    onSuccess: () => {
      toast('Claim requested');
      setMessage('');
      refresh();
    },
    onError: (e) => toast(errText(e), 'err'),
  });
  const decide = useMutation({
    mutationFn: ({ id, approve, reason }: { id: string; approve: boolean; reason?: string }) => api.post<Any>(`/players/claims/${id}/${approve ? 'approve' : 'reject'}`, approve ? {} : { reason }),
    onSuccess: (r) => {
      toast(r.status === 'ACCEPTED' ? `Merged ${r.mergedMatches} matches — stats are being recalculated` : 'Claim rejected');
      refresh();
    },
    onError: (e) => toast(errText(e), 'err'),
  });

  return (
    <div className="space-y-5">
      <PageHeader title="Record claims" subtitle="Played a quick match as T3 or P5? Claim those records into your profile." />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Claim a temporary player">
          <div className="space-y-3">
            <Field label="Message (optional)">
              <Input value={message} onChange={(e) => setMessage(e.target.value)} placeholder="I played as T3 in Sunday's match" />
            </Field>
            <Field label="Find the placeholder player" hint="Picking a player sends the claim to the match organizer / team captain">
              <PlayerPicker temporary onPick={(p) => request.mutate(p.id)} placeholder="Search temporary players (e.g. T3)…" />
            </Field>
          </div>
        </Card>
        <Card title="My claims">
          {!mine?.length ? (
            <p className="text-sm text-slate-400">No claims yet</p>
          ) : (
            <div className="space-y-2">
              {mine.map((c) => (
                <div key={c.id} className="flex items-center justify-between text-sm">
                  <span>
                    {c.temporaryPlayer.name} {c.temporaryPlayer.tempCode && <span className="text-slate-400">({c.temporaryPlayer.tempCode})</span>}
                  </span>
                  <span className="flex items-center gap-2 text-xs text-slate-400">
                    {fmtAgo(c.createdAt)} <Badge tone={TONE[c.status]}>{c.status}</Badge>
                  </span>
                </div>
              ))}
            </div>
          )}
        </Card>
      </div>
      <Card title="Claims to review" actions={<Select className="w-36" options={Object.keys(TONE).map((s) => ({ value: s, label: label(s) }))} value={status} onChange={(e) => setStatus(e.target.value)} />}>
        {isLoading ? (
          <Loading />
        ) : !review?.items.length ? (
          <Empty title="Nothing to review">Claims for players in your teams or matches appear here.</Empty>
        ) : (
          <div className="space-y-2">
            {review.items.map((c) => (
              <div key={c.id} className="flex flex-wrap items-center justify-between gap-3 rounded-xl bg-slate-50 p-3">
                <div className="flex items-center gap-3">
                  <Avatar name={c.requestedBy.name} src={c.requestedBy.photoUrl} />
                  <div className="text-sm">
                    <b>{c.requestedBy.name}</b> <span className="text-slate-500">({c.requestedBy.email})</span> claims{' '}
                    <Link className="font-semibold text-pitch-700 hover:underline" to={`/players/${c.temporaryPlayer.id}`}>
                      {c.temporaryPlayer.name}
                    </Link>
                    {c.message && <div className="text-xs text-slate-500">"{c.message}"</div>}
                  </div>
                </div>
                {c.status === 'PENDING' ? (
                  <div className="flex gap-2">
                    <Button size="sm" loading={decide.isPending} onClick={() => decide.mutate({ id: c.id, approve: true })}>
                      Approve & merge
                    </Button>
                    <Button size="sm" variant="secondary" onClick={() => decide.mutate({ id: c.id, approve: false, reason: prompt('Reason (optional)') ?? undefined })}>
                      Reject
                    </Button>
                  </div>
                ) : (
                  <Badge tone={TONE[c.status]}>{c.status}</Badge>
                )}
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
