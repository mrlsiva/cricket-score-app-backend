import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { MatchCard } from '../components/MatchCard';
import { Button, Checkbox, Empty, ErrorBox, Input, Loading, PageHeader, Pagination, Tabs, useDebounced } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { Match } from '../lib/types';

type Tab = 'live' | 'upcoming' | 'completed' | 'mine' | 'all';
const PATHS: Record<Tab, [string, Record<string, unknown>]> = {
  live: ['/matches/live', {}],
  upcoming: ['/matches/upcoming', {}],
  completed: ['/matches/completed', {}],
  mine: ['/matches', { mine: true, sortBy: 'createdAt' }],
  all: ['/matches', { sortBy: 'createdAt' }],
};

export default function MatchesPage() {
  const { can } = useAuth();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'live';
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [ground, setGround] = useState('');
  const [quick, setQuick] = useState(true);
  const q = useDebounced(search);
  const g = useDebounced(ground);
  const [path, extra] = PATHS[tab];
  const { data, isLoading, error } = useQuery({
    queryKey: ['matches', tab, page, q, g, quick],
    queryFn: () => api.page<Match>(path, { ...(extra as Record<string, string>), page, limit: 12, search: q, ground: g, includeQuick: quick }),
  });

  return (
    <div>
      <PageHeader
        title="Matches"
        subtitle="Live, upcoming and completed matches"
        actions={
          can('match:create') && (
            <>
              <Link to="/matches/quick">
                <Button variant="gold">⚡ Quick match</Button>
              </Link>
              <Link to="/matches/new">
                <Button>New match</Button>
              </Link>
            </>
          )
        }
      />
      <Tabs
        value={tab}
        onChange={(t) => {
          setPage(1);
          setParams({ tab: t });
        }}
        tabs={[
          { value: 'live', label: '🔴 Live' },
          { value: 'upcoming', label: 'Upcoming' },
          { value: 'completed', label: 'Completed' },
          { value: 'mine', label: 'Mine' },
          { value: 'all', label: 'All' },
        ]}
      />
      <div className="my-4 flex flex-wrap items-center gap-3">
        <Input className="max-w-xs" placeholder="Search team, match, ground…" value={search} onChange={(e) => setSearch(e.target.value)} />
        <Input className="max-w-[200px]" placeholder="Ground" value={ground} onChange={(e) => setGround(e.target.value)} />
        <Checkbox label="Include quick matches" checked={quick} onChange={setQuick} />
      </div>
      {error && <ErrorBox error={error} />}
      {isLoading ? (
        <Loading />
      ) : data?.items.length ? (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.items.map((m) => (
            <MatchCard key={m.id} m={m} />
          ))}
        </div>
      ) : (
        <Empty title="No matches found" />
      )}
      <Pagination meta={data?.meta} onPage={setPage} />
    </div>
  );
}
