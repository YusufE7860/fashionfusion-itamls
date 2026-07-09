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
    <div className="relative grid min-h-screen place-items-center overflow-hidden bg-ink-950 p-4">
      <div className="pointer-events-none absolute -left-32 top-0 h-[480px] w-[480px] rounded-full bg-brand-500/20 blur-[100px]" />
      <div className="pointer-events-none absolute -bottom-32 -right-20 h-[480px] w-[480px] rounded-full bg-teal-500/10 blur-[100px]" />
      <div className="pointer-events-none absolute inset-0 opacity-[0.04]"
           style={{ backgroundImage: 'linear-gradient(rgba(255,255,255,0.5) 1px, transparent 1px), linear-gradient(90deg, rgba(255,255,255,0.5) 1px, transparent 1px)', backgroundSize: '40px 40px' }} />

      <div className="relative w-full max-w-md">
        <div className="mb-8 flex justify-center"><FusionMark size="2xl" /></div>

        <div className="relative rounded-2xl border border-ink-500/60 bg-card-gradient p-8 shadow-card backdrop-blur-md">
          <div className="pointer-events-none absolute -inset-px rounded-2xl bg-gradient-to-b from-brand-500/40 via-transparent to-transparent opacity-60 [mask:linear-gradient(black,transparent_40%)]" />

          <h1 className="font-display text-2xl font-bold text-white">Welcome back</h1>
          <p className="mt-1 text-sm text-ink-200">Sign in to IT Asset Management</p>

          <form onSubmit={submit} className="mt-6 space-y-4">
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
              <div className="rounded-md border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-sm text-rose-300">
                {error}
              </div>
            )}
            <button className="btn-primary w-full py-2.5 text-base" disabled={loading}>
              <LogIn size={16}/>{loading ? 'Signing in…' : needs2fa ? 'Verify and sign in' : 'Sign in'}
            </button>
          </form>

          {!needs2fa && (
            <div className="mt-6 border-t border-ink-500/40 pt-4">
              <p className="text-[11px] uppercase tracking-wider text-ink-200">
                Demo accounts · password: <code className="rounded bg-ink-700/60 px-1 py-0.5 font-mono text-brand-300">password</code>
              </p>
              <div className="mt-2 flex flex-wrap gap-1.5 text-[11px]">
                {[
                  ['admin','Administrator'],['itmanager','IT Manager'],['tech','Technician'],
                  ['store001','Store Manager'],['finance','Finance'],
                ].map(([u, r]) => (
                  <button key={u} type="button"
                    onClick={() => setEmail(`${u}@fashionfusion.local`)}
                    className="rounded-full border border-ink-500/60 bg-ink-700/40 px-2.5 py-0.5 text-ink-100 hover:border-brand-500/40 hover:text-brand-300 transition-colors">
                    {r}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>

        <p className="mt-4 text-center text-[11px] text-ink-200">© Fashion Fusion · Internal use only</p>
      </div>
    </div>
  );
}
