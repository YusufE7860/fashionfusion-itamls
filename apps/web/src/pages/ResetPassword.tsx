/**
 * Forgot password - step 2 of 2.
 *
 * User lands here from the email link: /reset-password?token=XXX.
 * They pick a new password; we POST /auth/reset-password which validates
 * the token (exists / not expired / not used), updates the password, and
 * marks the token used so the link can't be reused.
 */
import { useEffect, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api/client';
import { Lock, CheckCircle2, ArrowLeft } from 'lucide-react';

export function ResetPassword() {
  const [params] = useSearchParams();
  const token = params.get('token') ?? '';
  const nav = useNavigate();

  const [p1, setP1]           = useState('');
  const [p2, setP2]           = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError]     = useState<string | null>(null);
  const [done, setDone]       = useState(false);

  useEffect(() => {
    // If someone navigates here without a token, bounce them to the forgot flow.
    if (!token) nav('/forgot-password', { replace: true });
  }, [token, nav]);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (p1.length < 8)  { setError('Password must be at least 8 characters.'); return; }
    if (p1 !== p2)       { setError('Passwords don\'t match.'); return; }
    setLoading(true); setError(null);
    try {
      await api.post('/auth/reset-password', { token, newPassword: p1 });
      setDone(true);
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Reset failed - the link may have expired.');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 to-slate-800 px-4 py-12 text-white">
      <div className="mx-auto max-w-md">
        <Link to="/login" className="mb-6 inline-flex items-center gap-1 text-xs text-slate-400 hover:text-white">
          <ArrowLeft size={12}/>Back to sign in
        </Link>
        <div className="rounded-2xl bg-white p-6 text-slate-800 shadow-xl">
          {done ? (
            <div className="space-y-3 text-center">
              <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-emerald-100 text-emerald-600">
                <CheckCircle2 size={24}/>
              </div>
              <h1 className="text-lg font-bold">Password updated</h1>
              <p className="text-sm text-slate-500">You can now sign in with your new password.</p>
              <Link to="/login" className="inline-block rounded-md bg-amber-500 px-4 py-2 text-sm font-semibold text-white hover:bg-amber-600">
                Go to sign in
              </Link>
            </div>
          ) : (
            <>
              <div className="mb-4 flex items-center gap-2">
                <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500 text-white">
                  <Lock size={18}/>
                </div>
                <div>
                  <h1 className="text-lg font-bold">Choose a new password</h1>
                  <p className="text-xs text-slate-500">At least 8 characters. Use something you'll remember.</p>
                </div>
              </div>
              <form onSubmit={submit} className="space-y-3">
                <label className="block">
                  <span className="text-xs font-semibold text-slate-700">New password</span>
                  <input
                    type="password" required autoFocus autoComplete="new-password"
                    className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
                    minLength={8}
                    value={p1} onChange={(e) => setP1(e.target.value)}
                  />
                </label>
                <label className="block">
                  <span className="text-xs font-semibold text-slate-700">Confirm new password</span>
                  <input
                    type="password" required autoComplete="new-password"
                    className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
                    minLength={8}
                    value={p2} onChange={(e) => setP2(e.target.value)}
                  />
                </label>
                {error && <div className="rounded-md bg-rose-50 p-2 text-xs text-rose-700">{error}</div>}
                <button
                  type="submit" disabled={loading}
                  className="w-full rounded-md bg-amber-500 py-2 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-60"
                >
                  {loading ? 'Saving…' : 'Set new password'}
                </button>
              </form>
            </>
          )}
        </div>
      </div>
    </div>
  );
}
