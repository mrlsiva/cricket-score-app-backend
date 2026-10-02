import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useNavigate } from 'react-router-dom';
import { MatchCard } from '../components/MatchCard';
import { Button, Card, Empty, errText, Loading, useToast } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtAgo } from '../lib/format';
import { Any, Match } from '../lib/types';

function MatchGrid({ title, path, empty, action }: { title: string; path: string; empty: string; action?: React.ReactNode }) {
  const { data, isLoading } = useQuery({ queryKey: ['matches', path], queryFn: () => api.page<Match>(path, { limit: 6, includeQuick: true }), refetchInterval: path.includes('live') ? 20_000 : false });
  return (
    <section>
      <div className="mb-3 flex items-center justify-between">
        <h2 className="text-lg font-bold">{title}</h2>
        {action}
      </div>
      {isLoading ? (
        <Loading />
      ) : data?.items.length ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.items.map((m) => (
            <MatchCard key={m.id} m={m} />
          ))}
        </div>
      ) : (
        <Empty title={empty} />
      )}
    </section>
  );
}

function PendingTransfers() {
  const qc = useQueryClient();
  const toast = useToast();
  const nav = useNavigate();
  const { data } = useQuery({ queryKey: ['scorer', 'pending'], queryFn: () => api.get<Any[]>('/scorer/transfers/pending'), refetchInterval: 15_000 });
  const respond = useMutation({
    mutationFn: ({ id, accept }: { id: string; accept: boolean; matchId: string }) => api.post(`/scorer/transfers/${id}/${accept ? 'accept' : 'reject'}`),
    onSuccess: (_d, v) => {
      qc.invalidateQueries({ queryKey: ['scorer'] });
      toast(v.accept ? 'You are now the scorer' : 'Transfer declined');
      if (v.accept) nav(`/matches/${v.matchId}/score`);
    },
    onError: (e) => toast(errText(e), 'err'),
  });
  if (!data?.length) return null;
  return (
    <Card title="Scoring requests" className="border-gold">
      <div className="space-y-2">
        {data.map((t) => (
          <div key={t.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-yellow-50 p-3">
            <div className="text-sm">
              <b>{t.fromUser?.name}</b> wants you to score{' '}
              <b>
                {t.match.teamA.name} vs {t.match.teamB.name}
              </b>
              <span className="text-slate-500"> · {fmtAgo(t.createdAt)}</span>
            </div>
            <div className="flex gap-2">
              <Button size="sm" onClick={() => respond.mutate({ id: t.id, accept: true, matchId: t.matchId })}>
                Accept
              </Button>
              <Button size="sm" variant="secondary" onClick={() => respond.mutate({ id: t.id, accept: false, matchId: t.matchId })}>
                Decline
              </Button>
            </div>
          </div>
        ))}
      </div>
    </Card>
  );
}

export default function HomePage() {
  const { user, can } = useAuth();
  return (
    <div className="space-y-8">
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-3xl bg-gradient-to-r from-pitch-800 to-pitch-600 p-6 text-white shadow-lg">
        <div>
          <h1 className="text-2xl font-bold">Hi {user?.name?.split(' ')[0]} 👋</h1>
          <p className="text-white/75">Score matches live, run tournaments and track every stat.</p>
        </div>
        <div className="flex flex-wrap gap-2">
          {can('match:create') && (
            <Link to="/matches/quick">
              <Button variant="gold">⚡ Quick match</Button>
            </Link>
          )}
          {can('match:create') && (
            <Link to="/matches/new">
              <Button variant="secondary">New match</Button>
            </Link>
          )}
          {can('tournament:create') && (
            <Link to="/tournaments/new">
              <Button variant="secondary">New tournament</Button>
            </Link>
          )}
          <Link to="/teams/join">
            <Button variant="secondary">Join team</Button>
          </Link>
        </div>
      </div>
      <PendingTransfers />
      <MatchGrid title="🔴 Live now" path="/matches/live" empty="No live matches right now" />
      <MatchGrid
        title="My matches"
        path="/matches?mine=true&sortBy=createdAt"
        empty="You haven't created or played any matches yet"
        action={
          <Link to="/matches?tab=mine" className="text-sm font-semibold text-pitch-600">
            View all →
          </Link>
        }
      />
      <MatchGrid title="Upcoming" path="/matches/upcoming" empty="No upcoming matches" />
      <MatchGrid title="Recent results" path="/matches/completed" empty="No completed matches yet" />
    </div>
  );
}
