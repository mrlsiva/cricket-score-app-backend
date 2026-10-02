import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Avatar, Badge, Button, Card, ConfirmButton, enumOptions, errText, Field, Input, Loading, PageHeader, Select, UploadButton, useToast } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { label } from '../lib/format';
import { closeSocket } from '../lib/live';
import { Any } from '../lib/types';
import { PLAYER_ROLES } from './Players';

export default function MePage() {
  const { user, reload, signOut } = useAuth();
  const toast = useToast();
  const nav = useNavigate();
  const { data: player, refetch } = useQuery({ queryKey: ['me-player'], queryFn: () => api.get<Any>('/players/me') });
  const [acct, setAcct] = useState({ name: '', city: '', mobile: '' });
  const [pl, setPl] = useState<Record<string, Any>>({});
  useEffect(() => {
    if (user) setAcct({ name: user.name, city: user.city ?? '', mobile: user.mobile ?? '' });
  }, [user]);
  useEffect(() => {
    if (player) setPl({ jerseyNumber: player.jerseyNumber ?? '', role: player.role ?? '', battingStyle: player.battingStyle ?? '', bowlingStyle: player.bowlingStyle ?? '', bowlingArm: player.bowlingArm ?? '' });
  }, [player]);
  if (!user) return <Loading />;

  const save = async (fn: () => Promise<unknown>) => {
    try {
      await fn();
      await reload();
      await refetch();
      toast('Saved');
    } catch (e) {
      toast(errText(e), 'err');
    }
  };
  const clean = (o: Record<string, Any>) => Object.fromEntries(Object.entries(o).filter(([, v]) => v !== ''));

  return (
    <div className="space-y-5">
      <PageHeader title="My profile" />
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Account">
          <div className="mb-4 flex items-center gap-4">
            <Avatar name={user.name} src={user.photoUrl} size={72} />
            <div>
              <div className="font-semibold">{user.email}</div>
              <div className="mt-1 flex flex-wrap gap-1">
                {user.roles.map((r) => (
                  <Badge key={r} tone="green">
                    {label(r)}
                  </Badge>
                ))}
              </div>
              <div className="mt-2">
                <UploadButton label="Change photo" onFile={(f) => api.upload('/users/me/photo', f).then(() => reload())} />
              </div>
            </div>
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Name">
              <Input value={acct.name} onChange={(e) => setAcct({ ...acct, name: e.target.value })} />
            </Field>
            <Field label="City">
              <Input value={acct.city} onChange={(e) => setAcct({ ...acct, city: e.target.value })} />
            </Field>
            <Field label="Mobile">
              <Input value={acct.mobile} onChange={(e) => setAcct({ ...acct, mobile: e.target.value })} />
            </Field>
          </div>
          <Button className="mt-3" onClick={() => save(() => api.patch('/users/me', clean(acct)))}>
            Save account
          </Button>
        </Card>
        <Card title="Player profile" actions={player && <Link to={`/players/${player.id}`} className="text-sm text-pitch-600">View public profile →</Link>}>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Jersey number">
              <Input type="number" min={0} max={999} value={pl.jerseyNumber ?? ''} onChange={(e) => setPl({ ...pl, jerseyNumber: e.target.value === '' ? '' : +e.target.value })} />
            </Field>
            <Field label="Role">
              <Select placeholder="—" options={enumOptions(PLAYER_ROLES)} value={pl.role ?? ''} onChange={(e) => setPl({ ...pl, role: e.target.value })} />
            </Field>
            <Field label="Batting style">
              <Select placeholder="—" options={enumOptions(['RIGHT_HAND', 'LEFT_HAND'])} value={pl.battingStyle ?? ''} onChange={(e) => setPl({ ...pl, battingStyle: e.target.value })} />
            </Field>
            <Field label="Bowling style">
              <Select
                placeholder="—"
                options={enumOptions(['FAST', 'MEDIUM_FAST', 'MEDIUM', 'OFF_SPIN', 'LEG_SPIN', 'LEFT_ARM_ORTHODOX', 'LEFT_ARM_WRIST_SPIN', 'NONE'])}
                value={pl.bowlingStyle ?? ''}
                onChange={(e) => setPl({ ...pl, bowlingStyle: e.target.value })}
              />
            </Field>
            <Field label="Bowling arm">
              <Select placeholder="—" options={enumOptions(['RIGHT', 'LEFT'])} value={pl.bowlingArm ?? ''} onChange={(e) => setPl({ ...pl, bowlingArm: e.target.value })} />
            </Field>
          </div>
          <Button className="mt-3" onClick={() => save(() => api.patch('/players/me', clean(pl)))}>
            Save player profile
          </Button>
        </Card>
      </div>
      <Card title="More">
        <div className="flex flex-wrap gap-2">
          <Link to="/claims">
            <Button variant="secondary">Claim quick-match records</Button>
          </Link>
          <Link to="/teams/join">
            <Button variant="secondary">My team join requests</Button>
          </Link>
          <ConfirmButton
            title="Delete your account?"
            message="Your account is deactivated and you are signed out. Match statistics are kept."
            onConfirm={async () => {
              await api.del('/users/me');
              closeSocket();
              await signOut();
              nav('/login');
            }}
          >
            Delete account
          </ConfirmButton>
        </div>
      </Card>
    </div>
  );
}
