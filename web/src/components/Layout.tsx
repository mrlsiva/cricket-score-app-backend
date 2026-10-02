import { useQuery } from '@tanstack/react-query';
import { useCallback, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { closeSocket, usePersonalEvents } from '../lib/live';
import { Avatar, Button, cx, useToast } from './ui';

const NAV = [
  { to: '/', label: 'Home', end: true },
  { to: '/matches', label: 'Matches' },
  { to: '/tournaments', label: 'Tournaments' },
  { to: '/teams', label: 'Teams' },
  { to: '/players', label: 'Players' },
  { to: '/stats', label: 'Stats' },
];

export function Layout() {
  const { user, signOut, hasRole } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [menu, setMenu] = useState(false);
  const { data: unread } = useQuery({
    queryKey: ['notifications', 'unread'],
    queryFn: async () => (await api.page('/notifications', { limit: 1, unreadOnly: true })).meta.unread ?? 0,
    refetchInterval: 30_000,
  });
  usePersonalEvents(
    useCallback(
      (p) => {
        toast(`${p.from.name} wants you to take over scoring`, 'info');
        nav(`/matches/${p.matchId}/score`);
      },
      [nav, toast],
    ),
  );

  const links = [...NAV, ...(hasRole('SUPER_ADMIN', 'ORGANIZER') ? [{ to: '/admin', label: 'Admin' }] : [])];

  return (
    <div className="flex min-h-screen flex-col">
      <header className="sticky top-0 z-40 bg-pitch-800 text-white shadow">
        <div className="mx-auto flex max-w-7xl items-center gap-4 px-4 py-3">
          <Link to="/" className="flex items-center gap-2 text-lg font-extrabold tracking-tight">
            <span className="inline-block h-6 w-6 rounded-full bg-ball shadow-inner ring-2 ring-white/30" />
            Cricket Scorer
          </Link>
          <nav className="hidden flex-1 gap-1 md:flex">
            {links.map((l) => (
              <NavLink key={l.to} to={l.to} end={l.end} className={({ isActive }) => cx('rounded-lg px-3 py-1.5 text-sm font-medium', isActive ? 'bg-white/15' : 'text-white/80 hover:bg-white/10')}>
                {l.label}
              </NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Link to="/notifications" className="relative rounded-lg p-2 hover:bg-white/10" aria-label="Notifications">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path d="M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0" />
              </svg>
              {!!unread && <span className="absolute -right-0.5 -top-0.5 rounded-full bg-gold px-1.5 text-[10px] font-bold text-pitch-900">{unread > 99 ? '99+' : unread}</span>}
            </Link>
            <div className="relative">
              <button onClick={() => setMenu((m) => !m)} className="flex items-center gap-2 rounded-lg p-1 hover:bg-white/10">
                <Avatar name={user?.name} src={user?.photoUrl} size={30} />
              </button>
              {menu && (
                <div className="absolute right-0 mt-2 w-56 overflow-hidden rounded-xl bg-white text-slate-700 shadow-xl" onClick={() => setMenu(false)}>
                  <div className="border-b border-slate-100 px-4 py-3">
                    <div className="font-semibold">{user?.name}</div>
                    <div className="truncate text-xs text-slate-500">{user?.email}</div>
                  </div>
                  {[
                    ['/me', 'My profile'],
                    ['/teams/join', 'Join a team'],
                    ['/claims', 'Record claims'],
                    ['/notifications', 'Notifications'],
                  ].map(([to, l]) => (
                    <Link key={to} to={to} className="block px-4 py-2 text-sm hover:bg-slate-50">
                      {l}
                    </Link>
                  ))}
                  <a href="/docs" target="_blank" className="block px-4 py-2 text-sm hover:bg-slate-50">
                    API docs ↗
                  </a>
                  <button
                    className="block w-full border-t border-slate-100 px-4 py-2 text-left text-sm text-ball hover:bg-slate-50"
                    onClick={async () => {
                      closeSocket();
                      await signOut();
                      nav('/login');
                    }}
                  >
                    Sign out
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>
        <nav className="flex gap-1 overflow-x-auto px-3 pb-2 md:hidden">
          {links.map((l) => (
            <NavLink key={l.to} to={l.to} end={l.end} className={({ isActive }) => cx('shrink-0 rounded-lg px-3 py-1 text-sm', isActive ? 'bg-white/15 font-semibold' : 'text-white/80')}>
              {l.label}
            </NavLink>
          ))}
        </nav>
      </header>
      <main className="mx-auto w-full max-w-7xl flex-1 px-4 py-6">
        <Outlet />
      </main>
      <footer className="border-t border-slate-200 bg-white py-4 text-center text-xs text-slate-500">Developed by Sling Groups</footer>
    </div>
  );
}

export function FullPageMessage({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center p-6">
      <div className="max-w-md text-center">
        <h1 className="text-xl font-bold">{title}</h1>
        <div className="mt-3 text-slate-600">{children}</div>
        <Link to="/">
          <Button className="mt-6">Go home</Button>
        </Link>
      </div>
    </div>
  );
}
