import { useQuery } from '@tanstack/react-query';
import { useState } from 'react';
import { api } from '../lib/api';
import { Any } from '../lib/types';
import { Avatar, Input, useDebounced } from './ui';

interface Option {
  id: string;
  name: string;
  sub?: string;
  photoUrl?: string | null;
}

function SearchPicker({ placeholder, fetcher, onPick, queryKey }: { placeholder: string; queryKey: string; fetcher: (q: string) => Promise<Option[]>; onPick: (o: Option) => void }) {
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const { data, isFetching } = useQuery({ queryKey: [queryKey, dq], queryFn: () => fetcher(dq), enabled: dq.length >= 1 });
  return (
    <div className="relative">
      <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={placeholder} />
      {dq && (
        <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-lg">
          {isFetching && <div className="px-3 py-2 text-sm text-slate-400">Searching…</div>}
          {!isFetching && !data?.length && <div className="px-3 py-2 text-sm text-slate-400">No results</div>}
          {data?.map((o) => (
            <button
              key={o.id}
              type="button"
              onClick={() => {
                onPick(o);
                setQ('');
              }}
              className="flex w-full items-center gap-3 px-3 py-2 text-left text-sm hover:bg-pitch-50"
            >
              <Avatar name={o.name} src={o.photoUrl} size={28} />
              <span>
                <span className="font-medium">{o.name}</span>
                {o.sub && <span className="block text-xs text-slate-500">{o.sub}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

export function UserPicker({ onPick, placeholder = 'Search users by name or email…' }: { onPick: (u: Option) => void; placeholder?: string }) {
  return (
    <SearchPicker
      queryKey="user-search"
      placeholder={placeholder}
      onPick={onPick}
      fetcher={async (q) => (await api.page<Any>('/users', { search: q, limit: 10 })).items.map((u) => ({ id: u.id, name: u.name, sub: u.email ?? u.city, photoUrl: u.photoUrl }))}
    />
  );
}

export function PlayerPicker({ onPick, temporary, placeholder = 'Search players…' }: { onPick: (p: Option) => void; temporary?: boolean; placeholder?: string }) {
  return (
    <SearchPicker
      queryKey={`player-search-${temporary}`}
      placeholder={placeholder}
      onPick={onPick}
      fetcher={async (q) =>
        (await api.page<Any>('/players', { search: q, limit: 10, temporary })).items.map((p) => ({
          id: p.id,
          name: p.name,
          sub: [p.isTemporary ? `Temporary${p.tempCode ? ` (${p.tempCode})` : ''}` : 'Registered', p.careerStats ? `${p.careerStats.matches} matches` : null].filter(Boolean).join(' · '),
          photoUrl: p.photoUrl,
        }))
      }
    />
  );
}

export function TeamSelect({ value, onChange, tournamentId, placeholder = 'Select team' }: { value: string; onChange: (id: string) => void; tournamentId?: string; placeholder?: string }) {
  const { data } = useQuery({
    queryKey: ['team-options', tournamentId],
    queryFn: () => api.page<Any>('/teams', { limit: 100, tournamentId, sortBy: 'name', sortOrder: 'asc' }),
  });
  return (
    <select value={value} onChange={(e) => onChange(e.target.value)} className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm">
      <option value="">{placeholder}</option>
      {data?.items.map((t) => (
        <option key={t.id} value={t.id}>
          {t.name}
        </option>
      ))}
    </select>
  );
}
