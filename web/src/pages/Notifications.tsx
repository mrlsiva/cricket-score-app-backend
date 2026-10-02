import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Badge, Button, Checkbox, cx, Empty, enumOptions, Loading, PageHeader, Pagination, Select } from '../components/ui';
import { api } from '../lib/api';
import { fmtAgo, label } from '../lib/format';
import { Any } from '../lib/types';

const TYPES = ['MATCH_STARTED', 'TOSS_COMPLETED', 'WICKET', 'SIX', 'FIFTY', 'HUNDRED', 'INNINGS_END', 'MATCH_RESULT', 'SCORER_TRANSFER', 'TOURNAMENT_INVITATION', 'TEAM_JOIN_REQUEST', 'TEAM_JOIN_APPROVAL', 'CLAIM_UPDATE'];

/** Where a notification should take the user. */
function target(n: Any): string | null {
  const d = n.data ?? {};
  if (n.type === 'SCORER_TRANSFER' && d.matchId) return `/matches/${d.matchId}/score`;
  if (d.matchId) return `/matches/${d.matchId}`;
  if (n.type === 'TEAM_JOIN_REQUEST' && d.teamId) return `/teams/${d.teamId}?tab=requests`;
  if (d.teamId && !d.tournamentId) return `/teams/${d.teamId}`;
  if (d.tournamentId) return `/tournaments/${d.tournamentId}`;
  if (d.claimId) return '/claims';
  return null;
}

export default function NotificationsPage() {
  const qc = useQueryClient();
  const nav = useNavigate();
  const [page, setPage] = useState(1);
  const [unreadOnly, setUnread] = useState(false);
  const [type, setType] = useState('');
  const { data, isLoading } = useQuery({ queryKey: ['notifications', page, unreadOnly, type], queryFn: () => api.page<Any>('/notifications', { page, limit: 20, unreadOnly: unreadOnly || undefined, type }) });
  const refresh = () => qc.invalidateQueries({ queryKey: ['notifications'] });
  const read = useMutation({ mutationFn: (id: string) => api.patch(`/notifications/${id}/read`), onSuccess: refresh });
  const readAll = useMutation({ mutationFn: () => api.post('/notifications/read-all'), onSuccess: refresh });

  return (
    <div>
      <PageHeader
        title="Notifications"
        subtitle={data?.meta.unread ? `${data.meta.unread} unread` : 'All caught up'}
        actions={
          <Button variant="secondary" disabled={!data?.meta.unread} loading={readAll.isPending} onClick={() => readAll.mutate()}>
            Mark all read
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Checkbox label="Unread only" checked={unreadOnly} onChange={setUnread} />
        <Select className="max-w-[220px]" placeholder="All types" options={enumOptions(TYPES)} value={type} onChange={(e) => setType(e.target.value)} />
      </div>
      {isLoading ? (
        <Loading />
      ) : !data?.items.length ? (
        <Empty title="No notifications" />
      ) : (
        <div className="divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white">
          {data.items.map((n) => (
            <button
              key={n.id}
              onClick={() => {
                if (!n.readAt) read.mutate(n.id);
                const to = target(n);
                if (to) nav(to);
              }}
              className={cx('flex w-full items-start gap-3 px-4 py-3 text-left hover:bg-slate-50', !n.readAt && 'bg-pitch-50/60')}
            >
              <span className={cx('mt-1.5 h-2 w-2 shrink-0 rounded-full', n.readAt ? 'bg-transparent' : 'bg-pitch-600')} />
              <div className="flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-semibold">{n.title}</span>
                  <Badge>{label(n.type)}</Badge>
                </div>
                <div className="text-sm text-slate-600">{n.body}</div>
              </div>
              <span className="shrink-0 text-xs text-slate-400">{fmtAgo(n.createdAt)}</span>
            </button>
          ))}
        </div>
      )}
      <Pagination meta={data?.meta} onPage={setPage} />
      <p className="mt-4 text-xs text-slate-400">Push notifications on phones are delivered through the Android app (FCM). Here you see the same in-app notification history.</p>
    </div>
  );
}
