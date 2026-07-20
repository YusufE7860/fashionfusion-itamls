import { FormEvent, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogIn, ShieldCheck } from 'lucide-react';
import { api } from '@/api/client';
import { useAuth } from '@/store/auth';
import { FusionMark } from '@/components/FusionMark';

export function Login() {
  const [email, setEmail] = useState('admin@fashionfusion.local');
  const [password, setPassword] = useState('password');
  const [totpToken, setTotpToken] = useState('');
  const [needs2fa, setNeeds2fa] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const setSession = useAuth((s) => s.setSession);
  const navigate = useNavigate();

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const body: any = { email, password };
      if (needs2fa && totpToken) body.totpToken = totpToken;
      const { data } = await api.post('/auth/login', body);
      setSession(data.accessToken, data.user);
      navigate('/');
    } catch (e: any) {
      const resp = e.response?.data;
      if (resp?.requires2fa) {
        setNeeds2fa(true);
        setError('Enter the 6-digit code from your authenticator app.');
      } else {
        setError(resp?.message ?? 'Login failed');
      }
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="grid min-h-screen bg-white md:grid-cols-2">
      {/* ---------- Left panel (brand) ---------- */}
      <div className="relative hidden flex-col justify-between overflow-hidden bg-[#0b0f1a] p-10 text-white md:flex">
        <div className="pointer-events-none absolute -left-24 top-0 h-[420px] w-[420px] rounded-full bg-brand-500/25 blur-[100px]" />
        <div className="pointer-events-none absolute -bottom-24 -right-16 h-[420px] w-[420px] rounded-full bg-teal-500/10 blur-[100px]" />

        <div className="relative">
          <FusionMark size="lg" />
          <div className="mt-4 text-[11px] font-bold uppercase tracking-[0.28em] text-ink-400">
            IT Command Center
          </div>
        </div>

        <div className="relative">
          <h2 className="font-display text-3xl font-bold leading-tight">
            One command center<br/>for your whole IT estate.
          </h2>
          <p className="mt-4 max-w-md text-sm text-ink-300/90">
            Assets, stores, tills, backups, toner, procurement, repairs — everything your IT department runs on, in one place.
          </p>
        </div>

        <div className="relative text-[11px] text-ink-400">
          © Fashion Fusion · Internal use only
        </div>
      </div>

      {/* ---------- Right panel (form) ---------- */}
      <div className="relative flex items-center justify-center px-6 py-12">
        <div className="w-full max-w-sm">
          <div className="mb-8 md:hidden flex justify-center">
            <div className="rounded-lg bg-[#0b0f1a] px-6 py-4">
              <FusionMark size="md" />
            </div>
          </div>

          <h1 className="font-display text-2xl font-bold text-ink-50">Welcome back</h1>
          <p className="mt-1 text-sm text-ink-300">Sign in to IT Asset Management</p>

          <form onSubmit={submit} className="mt-8 space-y-4">
            <div>
              <label className="label">Email</label>
              <input className="field" type="email" value={email}
                     onChange={(e) => setEmail(e.target.value)} required disabled={needs2fa} />
            </div>
            <div>
              <label className="label">Password</label>
              <input className="field" type="password" value={password}
                     onChange={(e) => setPassword(e.target.value)} required disabled={needs2fa} />
            </div>
            {needs2fa && (
              <div>
                <label className="label flex items-center gap-1"><ShieldCheck size={11}/>Two-factor code</label>
                <input className="field font-mono text-center text-lg tracking-[0.4em]" type="text"
                       value={totpToken} maxLength={6}
                       autoFocus autoComplete="one-time-code"
                       onChange={(e) => setTotpToken(e.target.value.replace(/\D/g, ''))} />
              </div>
            )}
            {error && (
              <div className="rounded-md border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-700">
                {error}
              </div>
            )}
            <button className="btn-primary w-full py-2.5 text-base" disabled={loading}>
              <LogIn size={16}/>{loading ? 'Signing in…' : needs2fa ? 'Verify and sign in' : 'Sign in'}
            </button>
          </form>

          <p className="mt-6 text-center text-[11px] text-ink-400">
            © Fashion Fusion · Internal use only
          </p>
        </div>
      </div>
    </div>
  );
}
