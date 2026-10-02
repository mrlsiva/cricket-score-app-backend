import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { AuditTable } from '../components/match/MatchTabs';
import { UserPicker } from '../components/pickers';
import { Avatar, Badge, Button, Card, Checkbox, Empty, enumOptions, errText, Field, Input, Loading, PageHeader, Pagination, Select, Tabs, useDebounced, useToast } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtDate, label } from '../lib/format';
import { Any, RoleName } from '../lib/types';

const ROLES: RoleName[] = ['SUPER_ADMIN', 'ORGANIZER', 'SCORER', 'TEAM_CAPTAIN', 'TEAM_MANAGER', 'PLAYER', 'VIEWER'];
type Tab = 'audit' | 'roles' | 'users';

export default function AdminPage() {
  const { hasRole } = useAuth();
  const admin = hasRole('SUPER_ADMIN');
  const [tab, setTab] = useState<Tab>('audit');
  return (
    <div className="space-y-4">
      <PageHeader title="Admin" subtitle={admin ? 'Super admin tools' : 'Organizer tools'} />
      <Tabs
        value={tab}
        onChange={setTab}
        tabs={[{ value: 'audit', label: 'Audit logs' }, ...(admin ? [{ value: 'roles' as const, label: 'Roles & permissions' }, { value: 'users' as const, label: 'Users' }] : [])]}
      />
      {tab === 'audit' && <Audit admin={admin} />}
      {tab === 'roles' && admin && <RolesAdmin />}
      {tab === 'users' && admin && <UsersAdmin />}
    </div>
  );
}

function Audit({ admin }: { admin: boolean }) {
  const [page, setPage] = useState(1);
  const [f, setF] = useState({ matchId: '', entityType: '', action: '', from: '', to: '' });
  const matchId = useDebounced(f.matchId);
  const enabled = admin || /^[0-9a-f-]{36}$/i.test(matchId);
  const { data, isLoading, error } = useQuery({
    queryKey: ['audit-all', page, matchId, f.entityType, f.action, f.from, f.to],
    queryFn: () =>
      api.page<Any>('/audit-logs', {
        page,
        limit: 30,
        matchId,
        entityType: f.entityType,
        action: f.action,
        from: f.from ? new Date(f.from).toISOString() : undefined,
        to: f.to ? new Date(f.to).toISOString() : undefined,
      }),
    enabled,
  });
  return (
    <div className="space-y-3">
      <Card>
        <div className="grid gap-3 sm:grid-cols-5">
          <Input placeholder={admin ? 'Match id (optional)' : 'Match id (required)'} value={f.matchId} onChange={(e) => setF({ ...f, matchId: e.target.value.trim() })} />
          <Select placeholder="Any entity" options={enumOptions(['BALL', 'MATCH', 'MATCH_RESULT', 'MATCH_SQUAD', 'INNINGS', 'SCORER_LOCK', 'AWARD', 'TEAM', 'TOURNAMENT', 'PLAYER', 'PLAYER_CLAIM', 'TEAM_JOIN_REQUEST'])} value={f.entityType} onChange={(e) => setF({ ...f, entityType: e.target.value })} />
          <Input placeholder="Action (UPDATE, DELETE…)" value={f.action} onChange={(e) => setF({ ...f, action: e.target.value.toUpperCase() })} />
          <Input type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} />
          <Input type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} />
        </div>
        {!admin && <p className="mt-2 text-xs text-slate-400">Organizers see audit history of their own matches (also available on each match's Audit tab).</p>}
      </Card>
      {!enabled ? <Empty title="Enter a match id" /> : isLoading ? <Loading /> : error ? <Empty title={errText(error)} /> : <AuditTable items={data?.items ?? []} meta={data?.meta} onPage={setPage} />}
    </div>
  );
}

function RolesAdmin() {
  const qc = useQueryClient();
  const toast = useToast();
  const { data: roles, isLoading } = useQuery({ queryKey: ['roles'], queryFn: () => api.get<Any[]>('/roles') });
  const { data: perms } = useQuery({ queryKey: ['permissions'], queryFn: () => api.get<string[]>('/roles/permissions') });
  const [edit, setEdit] = useState<Record<string, string[]>>({});
  useEffect(() => {
    if (roles) setEdit(Object.fromEntries(roles.map((r) => [r.name, r.permissions as string[]])));
  }, [roles]);
  const save = useMutation({
    mutationFn: (name: string) => api.patch(`/roles/${name}/permissions`, { permissions: edit[name] }),
    onSuccess: () => {
      toast('Permissions saved');
      qc.invalidateQueries({ queryKey: ['roles'] });
    },
    onError: (e) => toast(errText(e), 'err'),
  });
  if (isLoading) return <Loading />;
  return (
    <div className="grid gap-4 md:grid-cols-2">
      {roles?.map((r) => (
        <Card key={r.name} title={label(r.name)} actions={<Button size="sm" loading={save.isPending && save.variables === r.name} onClick={() => save.mutate(r.name)}>Save</Button>}>
          <p className="mb-2 text-xs text-slate-500">{r.description}</p>
          <div className="grid grid-cols-2 gap-1">
            {(perms ?? []).map((p) => (
              <Checkbox
                key={p}
                label={<span className="font-mono text-xs">{p}</span>}
                checked={edit[r.name]?.includes(p) ?? false}
                onChange={(c) => setEdit((s) => ({ ...s, [r.name]: c ? [...(s[r.name] ?? []), p] : (s[r.name] ?? []).filter((x) => x !== p) }))}
              />
            ))}
          </div>
        </Card>
      ))}
    </div>
  );
}

function UsersAdmin() {
  const toast = useToast();
  const qc = useQueryClient();
  const [page, setPage] = useState(1);
  const [search, setSearch] = useState('');
  const [role, setRole] = useState('');
  const q = useDebounced(search);
  const { data, isLoading } = useQuery({ queryKey: ['admin-users', page, q, role], queryFn: () => api.page<Any>('/users', { page, limit: 20, search: q, role }) });
  const [target, setTarget] = useState<{ id: string; name: string } | null>(null);
  const [grant, setGrant] = useState<RoleName>('ORGANIZER');
  const act = async (fn: () => Promise<Any>, ok: string) => {
    try {
      const r = await fn();
      toast(r?.roles ? `${ok}: ${r.roles.join(', ')}` : ok);
      qc.invalidateQueries({ queryKey: ['admin-users'] });
    } catch (e) {
      toast(errText(e), 'err');
    }
  };
  return (
    <div className="space-y-4">
      <Card title="Grant / revoke roles">
        <div className="grid gap-3 sm:grid-cols-4">
          <Field label="User" hint={target ? `Selected: ${target.name}` : undefined} className="sm:col-span-2">
            <UserPicker onPick={setTarget} />
          </Field>
          <Field label="Role">
            <Select options={enumOptions(ROLES)} value={grant} onChange={(e) => setGrant(e.target.value as RoleName)} />
          </Field>
          <div className="flex items-end gap-2">
            <Button disabled={!target} onClick={() => act(() => api.post(`/roles/users/${target!.id}`, { roles: [grant] }), 'Granted')}>
              Grant
            </Button>
            <Button variant="secondary" disabled={!target} onClick={() => act(() => api.del(`/roles/users/${target!.id}`, { roles: [grant] }), 'Revoked')}>
              Revoke
            </Button>
          </div>
        </div>
      </Card>
      <Card title="Users">
        <div className="mb-3 flex flex-wrap gap-2">
          <Input className="max-w-xs" placeholder="Search name / email…" value={search} onChange={(e) => setSearch(e.target.value)} />
          <Select className="max-w-[200px]" placeholder="Any role" options={enumOptions(ROLES)} value={role} onChange={(e) => setRole(e.target.value)} />
        </div>
        {isLoading ? (
          <Loading />
        ) : (
          <div className="divide-y divide-slate-100">
            {data?.items.map((u) => (
              <div key={u.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div className="flex items-center gap-3">
                  <Avatar name={u.name} src={u.photoUrl} size={32} />
                  <div className="text-sm">
                    <div className="font-semibold">{u.name}</div>
                    <div className="text-xs text-slate-500">
                      {u.email} · {u.city ?? '—'} · joined {fmtDate(u.createdAt)}
                    </div>
                  </div>
                </div>
                <div className="flex items-center gap-2">
                  {u.player && <Badge tone="green">player</Badge>}
                  <Button size="sm" variant="ghost" onClick={() => act(() => api.patch(`/users/${u.id}/status`, { isActive: false }), 'User deactivated')}>
                    Deactivate
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => act(() => api.patch(`/users/${u.id}/status`, { isActive: true }), 'User activated')}>
                    Activate
                  </Button>
                </div>
              </div>
            ))}
          </div>
        )}
        <Pagination meta={data?.meta} onPage={setPage} />
      </Card>
    </div>
  );
}
