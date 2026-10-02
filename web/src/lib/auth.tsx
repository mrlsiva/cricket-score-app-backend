import { useQueryClient } from '@tanstack/react-query';
import { createContext, ReactNode, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { api, setLogoutHandler, tokens } from './api';
import { Me, RoleName } from './types';

interface AuthState {
  user: Me | null;
  loading: boolean;
  signIn: (accessToken: string, refreshToken: string) => Promise<Me>;
  signOut: () => Promise<void>;
  reload: () => Promise<Me | null>;
  hasRole: (...roles: RoleName[]) => boolean;
  can: (permission: string) => boolean;
}

const Ctx = createContext<AuthState | null>(null);

// Mirrors the server's default permission matrix (used only to hide UI; the server enforces).
const ROLE_PERMS: Record<RoleName, string[]> = {
  SUPER_ADMIN: ['*'],
  ORGANIZER: ['tournament:create', 'tournament:manage', 'team:create', 'team:manage', 'match:create', 'match:manage', 'score:write', 'award:override', 'audit:read', 'gallery:upload'],
  SCORER: ['score:write', 'gallery:upload'],
  TEAM_CAPTAIN: ['team:manage', 'match:create', 'gallery:upload'],
  TEAM_MANAGER: ['team:create', 'team:manage', 'gallery:upload'],
  PLAYER: ['gallery:upload'],
  VIEWER: [],
};

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient();
  const [user, setUser] = useState<Me | null>(null);
  const [loading, setLoading] = useState(!!tokens.access);

  const reload = useCallback(async () => {
    if (!tokens.access) {
      setUser(null);
      return null;
    }
    try {
      const me = await api.get<Me>('/auth/me');
      setUser(me);
      return me;
    } catch {
      setUser(null);
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    setLogoutHandler(() => {
      setUser(null);
      qc.clear();
    });
    reload();
  }, [reload, qc]);

  const value = useMemo<AuthState>(
    () => ({
      user,
      loading,
      reload,
      async signIn(access, refresh) {
        tokens.save(access, refresh);
        const me = await reload();
        if (!me) throw new Error('Sign-in failed');
        return me;
      },
      async signOut() {
        const refresh = tokens.refresh;
        if (refresh) await api.post('/auth/logout', { refreshToken: refresh }).catch(() => undefined);
        tokens.clear();
        setUser(null);
        qc.clear();
      },
      hasRole: (...roles) => !!user && roles.some((r) => user.roles.includes(r)),
      can: (perm) => !!user && user.roles.some((r) => ROLE_PERMS[r]?.includes('*') || ROLE_PERMS[r]?.includes(perm)),
    }),
    [user, loading, reload, qc],
  );

  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useAuth() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error('useAuth outside AuthProvider');
  return ctx;
}
