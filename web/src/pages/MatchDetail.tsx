import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { GraphsView } from '../components/match/Graphs';
import { LiveView } from '../components/match/LiveView';
import { AuditView, AwardsView, CommentaryView, GalleryView, ManageView, SquadsView, TimelineView } from '../components/match/MatchTabs';
import { ScorecardView } from '../components/match/Scorecard';
import { Badge, Button, ErrorBox, errText, Loading, Tabs, TeamLogo, useToast } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDateTime, label, STATUS_TONE, teamScore } from '../lib/format';
import { useLiveMatch } from '../lib/live';
import { Any, Match, Snapshot } from '../lib/types';

type Tab = 'live' | 'scorecard' | 'commentary' | 'graphs' | 'squads' | 'gallery' | 'awards' | 'timeline' | 'audit' | 'manage';

const EXPORTS = [
  ['scorecard.pdf', 'Scorecard PDF'],
  ['summary.pdf', 'Summary PDF'],
  ['scorecard.png', 'Scorecard image'],
  ['share.png', 'WhatsApp image'],
];

export default function MatchDetailPage() {
  const { id = '' } = useParams();
  const { user, hasRole } = useAuth();
  const toast = useToast();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'live';
  const { data: match, isLoading, error } = useQuery({ queryKey: ['match', id], queryFn: () => api.get<Match>(`/matches/${id}`) });
  const { data: initial } = useQuery({ queryKey: ['live', id], queryFn: () => api.get<Snapshot>(`/matches/${id}/live`) });
  const { data: scorer } = useQuery({ queryKey: ['scorer', id], queryFn: () => api.get<Any>(`/matches/${id}/scorer`) });
  const { snapshot, feed, connected, spectators } = useLiveMatch(id);
  const [following, setFollowing] = useState(false);
  const snap = snapshot ?? initial;

  // keep the header in sync when the server pushes status changes
  useEffect(() => {
    if (snap && match && snap.match.status !== match.status) qc.invalidateQueries({ queryKey: ['match', id] });
  }, [snap, match, qc, id]);

  if (isLoading) return <Loading />;
  if (error || !match) return <ErrorBox error={error} />;

  const isOwner = match.createdById === user?.id || hasRole('SUPER_ADMIN') || (!!match.tournament && hasRole('ORGANIZER'));
  const isScorer = scorer?.isMe;
  const status = snap?.match.status ?? match.status;
  const canScore = isScorer || (isOwner && ['TOSS_COMPLETED', 'LIVE', 'INNINGS_BREAK'].includes(status)) || (isOwner && match.resultType === 'TIE');

  const follow = async () => {
    try {
      await api.post(`/notifications/topics/${following ? 'unsubscribe' : 'subscribe'}`, { topic: `match_${id}` });
      setFollowing(!following);
      toast(following ? 'Unfollowed' : 'Following — you will get push alerts on your devices');
    } catch (e) {
      toast(errText(e), 'err');
    }
  };

  const tabs: { value: Tab; label: string }[] = [
    { value: 'live', label: 'Live' },
    { value: 'scorecard', label: 'Scorecard' },
    { value: 'commentary', label: 'Commentary' },
    { value: 'graphs', label: 'Graphs' },
    { value: 'squads', label: 'Squads' },
    { value: 'gallery', label: 'Gallery' },
    { value: 'awards', label: 'Awards' },
    { value: 'timeline', label: 'Timeline' },
    ...(isOwner ? ([{ value: 'audit', label: 'Audit' }, { value: 'manage', label: 'Manage' }] as const) : []),
  ];

  return (
    <div className="space-y-5">
      <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm">
        <div className="mb-3 flex flex-wrap items-center gap-2 text-sm text-slate-500">
          {match.tournament && (
            <Link to={`/tournaments/${match.tournament.id}`} className="font-semibold text-pitch-600 hover:underline">
              {match.tournament.name}
            </Link>
          )}
          <span>{match.name}</span>
          <Badge tone={STATUS_TONE[status]} pulse={status === 'LIVE'}>
            {snap?.match.isPaused ? 'Paused' : label(status)}
          </Badge>
          {match.stage !== 'FRIENDLY' && <Badge tone="purple">{label(match.stage)}</Badge>}
          <span className="ml-auto flex items-center gap-1 text-xs">
            <span className={`h-2 w-2 rounded-full ${connected ? 'bg-green-500' : 'bg-slate-300'}`} />
            {connected ? `Live${spectators ? ` · ${spectators} watching` : ''}` : 'Offline'}
          </span>
        </div>
        <div className="grid gap-3 sm:grid-cols-2">
          {[match.teamA, match.teamB].map((t) => (
            <Link key={t.id} to={t.isTemporary ? '#' : `/teams/${t.id}`} className="flex items-center gap-3">
              <TeamLogo team={t} size={44} />
              <div>
                <div className={`text-lg font-bold ${match.winnerTeamId === t.id ? 'text-pitch-700' : ''}`}>{t.name}</div>
                <div className="font-semibold tabular text-slate-700">{teamScore(match, t.id) || '—'}</div>
              </div>
            </Link>
          ))}
        </div>
        <div className="mt-3 text-sm">
          {match.resultText ? <span className="font-bold text-pitch-700">{match.resultText}</span> : <span className="text-slate-500">{match.tossText ?? 'Toss pending'}</span>}
        </div>
        <div className="mt-1 text-xs text-slate-400">
          {match.overs} overs · {match.playersPerTeam} a side · {fmtDateTime(match.scheduledAt)}
          {match.ground ? ` · ${match.ground}` : ''}
          {match.umpireName ? ` · Umpire ${match.umpireName}` : ''}
          {scorer?.scorer ? ` · Scorer ${scorer.scorer.name}` : ''}
        </div>
        <div className="mt-4 flex flex-wrap gap-2">
          {canScore && (
            <Link to={`/matches/${id}/score`}>
              <Button variant="gold">{status === 'TOSS_COMPLETED' ? '▶ Start scoring' : '🏏 Scoring console'}</Button>
            </Link>
          )}
          <Button variant="secondary" size="sm" onClick={follow}>
            {following ? '🔕 Unfollow' : '🔔 Follow'}
          </Button>
          {EXPORTS.map(([f, l]) => (
            <Button key={f} variant="ghost" size="sm" onClick={() => api.download(`/matches/${id}/export/${f}`, `match-${f}`).catch((e) => toast(errText(e), 'err'))}>
              ⬇ {l}
            </Button>
          ))}
        </div>
      </div>

      <Tabs value={tab} onChange={(t) => setParams({ tab: t })} tabs={tabs} />

      {tab === 'live' && <LiveView snap={snap} feed={feed} />}
      {tab === 'scorecard' && <ScorecardView matchId={id} />}
      {tab === 'commentary' && <CommentaryView matchId={id} canWrite={!!(isScorer || isOwner)} />}
      {tab === 'graphs' && <GraphsView matchId={id} teamName={(tid) => (tid === match.teamAId ? match.teamA.name : match.teamB.name)} />}
      {tab === 'squads' && <SquadsView match={match} canManage={isOwner} />}
      {tab === 'gallery' && <GalleryView matchId={id} userId={user!.id} canManage={isOwner} />}
      {tab === 'awards' && <AwardsView match={match} canOverride={isOwner} />}
      {tab === 'timeline' && <TimelineView matchId={id} />}
      {tab === 'audit' && isOwner && <AuditView matchId={id} />}
      {tab === 'manage' && isOwner && <ManageView match={match} />}
    </div>
  );
}
