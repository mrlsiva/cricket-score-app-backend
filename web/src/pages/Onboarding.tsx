import { useState } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { Button, cx, errText, Field, Input, useToast } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

const TYPES = [
  { value: 'ORGANIZER', title: 'Organizer', text: 'Create tournaments, teams and matches. Manage fixtures, scorers and results.' },
  { value: 'INDIVIDUAL', title: 'Individual', text: 'Join teams, play, score when assigned, follow live matches and track your stats.' },
] as const;

export default function OnboardingPage() {
  const { user, reload } = useAuth();
  const nav = useNavigate();
  const toast = useToast();
  const [types, setTypes] = useState<string[]>(['INDIVIDUAL']);
  const [city, setCity] = useState(user?.city ?? '');
  const [mobile, setMobile] = useState(user?.mobile ?? '');
  const [busy, setBusy] = useState(false);

  if (user?.isOnboarded) return <Navigate to="/" replace />;

  const submit = async () => {
    setBusy(true);
    try {
      await api.post('/auth/onboarding', { accountTypes: types, city: city || undefined, mobile: mobile || undefined });
      await reload();
      nav('/', { replace: true });
    } catch (e) {
      toast(errText(e), 'err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen items-center justify-center bg-slate-50 p-4">
      <div className="w-full max-w-xl rounded-3xl bg-white p-8 shadow-xl">
        <h1 className="text-2xl font-bold">Welcome, {user?.name?.split(' ')[0]}!</h1>
        <p className="mt-1 text-slate-500">How will you use Cricket Scorer? You can pick both.</p>
        <div className="mt-6 grid gap-3 sm:grid-cols-2">
          {TYPES.map((t) => {
            const on = types.includes(t.value);
            return (
              <button
                key={t.value}
                type="button"
                onClick={() => setTypes((s) => (on ? s.filter((x) => x !== t.value) : [...s, t.value]))}
                className={cx('rounded-2xl border-2 p-4 text-left transition', on ? 'border-pitch-600 bg-pitch-50' : 'border-slate-200 hover:border-slate-300')}
              >
                <div className="flex items-center justify-between font-semibold">
                  {t.title}
                  <span className={cx('h-5 w-5 rounded-full border-2', on ? 'border-pitch-600 bg-pitch-600' : 'border-slate-300')} />
                </div>
                <p className="mt-1 text-sm text-slate-500">{t.text}</p>
              </button>
            );
          })}
        </div>
        <div className="mt-6 grid gap-4 sm:grid-cols-2">
          <Field label="City">
            <Input value={city} onChange={(e) => setCity(e.target.value)} placeholder="Chennai" />
          </Field>
          <Field label="Mobile (optional)">
            <Input value={mobile} onChange={(e) => setMobile(e.target.value)} placeholder="+919876543210" />
          </Field>
        </div>
        <Button className="mt-6 w-full" size="lg" disabled={!types.length} loading={busy} onClick={submit}>
          Get started
        </Button>
      </div>
    </div>
  );
}
