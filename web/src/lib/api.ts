/** REST client for /api/v1 with bearer auth and transparent refresh-token rotation. */
const BASE = '/api/v1';
const K = { access: 'cs.access', refresh: 'cs.refresh' };

export class ApiError extends Error {
  constructor(
    message: string,
    public status: number,
    public details?: unknown,
  ) {
    super(message);
  }
}

export interface PageMeta {
  page: number;
  limit: number;
  total: number;
  totalPages: number;
  unread?: number;
}
export interface Page<T> {
  items: T[];
  meta: PageMeta;
}

type Query = Record<string, string | number | boolean | undefined | null | string[]>;

const store = {
  get: (k: string) => {
    try {
      return localStorage.getItem(k);
    } catch {
      return null;
    }
  },
  set: (k: string, v: string | null) => {
    try {
      if (v === null) localStorage.removeItem(k);
      else localStorage.setItem(k, v);
    } catch {
      /* storage unavailable */
    }
  },
};

export const tokens = {
  get access() {
    return store.get(K.access);
  },
  get refresh() {
    return store.get(K.refresh);
  },
  save(access: string, refresh: string) {
    store.set(K.access, access);
    store.set(K.refresh, refresh);
  },
  clear() {
    store.set(K.access, null);
    store.set(K.refresh, null);
  },
};

let onLogout: () => void = () => undefined;
export const setLogoutHandler = (fn: () => void) => (onLogout = fn);

function url(path: string, query?: Query) {
  const u = new URL(BASE + path, window.location.origin);
  for (const [k, v] of Object.entries(query ?? {})) {
    if (v === undefined || v === null || v === '') continue;
    u.searchParams.set(k, Array.isArray(v) ? v.join(',') : String(v));
  }
  return u.pathname + u.search;
}

let refreshing: Promise<boolean> | null = null;
async function refresh(): Promise<boolean> {
  if (!tokens.refresh) return false;
  refreshing ??= (async () => {
    try {
      const res = await fetch(BASE + '/auth/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ refreshToken: tokens.refresh }),
      });
      if (!res.ok) return false;
      const { data } = await res.json();
      tokens.save(data.accessToken, data.refreshToken);
      return true;
    } catch {
      return false;
    } finally {
      setTimeout(() => (refreshing = null), 0);
    }
  })();
  return refreshing;
}

async function raw(method: string, path: string, opts: { query?: Query; body?: unknown; form?: FormData } = {}, retry = true): Promise<Response> {
  const headers: Record<string, string> = {};
  if (tokens.access) headers.Authorization = `Bearer ${tokens.access}`;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';
  const res = await fetch(url(path, opts.query), {
    method,
    headers,
    body: opts.form ?? (opts.body !== undefined ? JSON.stringify(opts.body) : undefined),
  });
  if (res.status === 401 && retry && !path.startsWith('/auth/')) {
    if (await refresh()) return raw(method, path, opts, false);
    tokens.clear();
    onLogout();
  }
  return res;
}

async function json<T>(res: Response): Promise<{ data: T; meta?: PageMeta }> {
  const body = await res.json().catch(() => null);
  if (!res.ok || !body?.success) {
    const details = body?.details;
    const msg = Array.isArray(details) ? details.join(', ') : (body?.message ?? `Request failed (${res.status})`);
    throw new ApiError(msg, res.status, details);
  }
  return body;
}

export const api = {
  async get<T>(path: string, query?: Query): Promise<T> {
    return (await json<T>(await raw('GET', path, { query }))).data;
  },
  async page<T>(path: string, query?: Query): Promise<Page<T>> {
    const b = await json<T[]>(await raw('GET', path, { query }));
    return { items: b.data, meta: b.meta! };
  },
  async post<T>(path: string, body: unknown = {}, query?: Query): Promise<T> {
    return (await json<T>(await raw('POST', path, { body, query }))).data;
  },
  async patch<T>(path: string, body: unknown = {}): Promise<T> {
    return (await json<T>(await raw('PATCH', path, { body }))).data;
  },
  async put<T>(path: string, body: unknown = {}): Promise<T> {
    return (await json<T>(await raw('PUT', path, { body }))).data;
  },
  async del<T>(path: string, body?: unknown): Promise<T> {
    return (await json<T>(await raw('DELETE', path, { body }))).data;
  },
  async upload<T>(path: string, file: File, fields: Record<string, string> = {}, query?: Query): Promise<T> {
    const form = new FormData();
    form.append('file', file);
    Object.entries(fields).forEach(([k, v]) => v && form.append(k, v));
    return (await json<T>(await raw('POST', path, { form, query }))).data;
  },
  /** Authenticated binary download (exports, QR PNG). */
  async download(path: string, filename: string) {
    const res = await raw('GET', path);
    if (!res.ok) throw new ApiError(`Download failed (${res.status})`, res.status);
    const blob = await res.blob();
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  },
  /** Authenticated blob URL for previews (images). */
  async blobUrl(path: string) {
    const res = await raw('GET', path);
    if (!res.ok) throw new ApiError(`Load failed (${res.status})`, res.status);
    return URL.createObjectURL(await res.blob());
  },
};
