import { useQuery } from '@tanstack/react-query';
import { FormEvent, useEffect, useRef, useState } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router-dom';
import { Button, ErrorBox, errText, Field, Input, Loading, useToast } from '../components/ui';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';

interface AuthResult {
  accessToken: string;
  refreshToken: string;
  requiresOnboarding: boolean;
}

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (o: { client_id: string; callback: (r: { credential: string }) => void }) => void;
          renderButton: (el: HTMLElement, o: Record<string, unknown>) => void;
        };
      };
    };
  }
}

function GoogleButton({ clientId, onToken }: { clientId: string; onToken: (idToken: string) => void }) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const render = () => {
      if (!window.google || !ref.current) return;
      window.google.accounts.id.initialize({ client_id: clientId, callback: (r) => onToken(r.credential) });
      window.google.accounts.id.renderButton(ref.current, { theme: 'filled_blue', size: 'large', shape: 'pill', width: 300, text: 'continue_with' });
    };
    if (window.google) return render();
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = render;
    document.head.appendChild(s);
  }, [clientId, onToken]);
  return <div ref={ref} className="flex justify-center" />;
}

export default function LoginPage() {
  const { user, signIn } = useAuth();
  const nav = useNavigate();
  const loc = useLocation();
  const toast = useToast();
  const from = (loc.state as { from?: string } | null)?.from ?? '/';
  const { data: cfg, isLoading, error } = useQuery({
    queryKey: ['auth-config'],
    queryFn: () => api.get<{ googleClientId: string | null; devLogin: boolean }>('/auth/config'),
  });
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={user.isOnboarded ? from : '/onboarding'} replace />;

  const finish = async (r: AuthResult) => {
    await signIn(r.accessToken, r.refreshToken);
    nav(r.requiresOnboarding ? '/onboarding' : from, { replace: true });
  };

  const google = async (idToken: string) => {
    try {
      await finish(await api.post<AuthResult>('/auth/google', { idToken }));
    } catch (e) {
      toast(errText(e), 'err');
    }
  };

  const dev = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    try {
      await finish(await api.post<AuthResult>('/auth/dev-login', { email, name: name || email.split('@')[0] }));
    } catch (err) {
      toast(errText(err), 'err');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-gradient-to-br from-pitch-900 via-pitch-800 to-pitch-600">
      <div className="flex flex-1 items-center justify-center p-4">
        <div className="w-full max-w-md rounded-3xl bg-white p-8 shadow-2xl">
          <div className="mb-6 text-center">
            <div className="mx-auto mb-3 h-14 w-14 rounded-full bg-ball shadow-lg ring-4 ring-red-100" />
            <h1 className="text-2xl font-extrabold text-pitch-800">Cricket Scorer</h1>
            <p className="mt-1 text-sm text-slate-500">Live scoring · Tournaments · Stats</p>
          </div>
          {isLoading && <Loading />}
          {error && <ErrorBox error={error} />}
          {cfg?.googleClientId && <GoogleButton clientId={cfg.googleClientId} onToken={google} />}
          {cfg && !cfg.googleClientId && !cfg.devLogin && (
            <p className="text-center text-sm text-slate-500">Google Sign-In is not configured on the server (GOOGLE_CLIENT_IDS).</p>
          )}
          {cfg?.devLogin && (
            <form onSubmit={dev} className="mt-6 space-y-3 border-t border-slate-100 pt-6">
              <div className="text-xs font-semibold uppercase tracking-wide text-amber-600">Development login (no Google)</div>
              <Field label="Email">
                <Input type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" />
              </Field>
              <Field label="Name">
                <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" />
              </Field>
              <Button className="w-full" size="lg" loading={busy}>
                Continue
              </Button>
            </form>
          )}
        </div>
      </div>
      <footer className="py-4 text-center text-xs text-white/60">Developed by Sling Groups</footer>
    </div>
  );
}
