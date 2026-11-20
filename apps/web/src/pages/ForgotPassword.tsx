/**
 * Forgot password - step 1 of 2.
 *
 * User enters their email, we POST /auth/forgot-password which always
 * returns the same message whether the account exists or not (to prevent
 * email enumeration). The real reset link goes out by email.
 */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api/client';
import { Mail, ArrowLeft } from 'lucide-react';

export function ForgotPassword() {
  const [email, setEmail]       = useState('');
  const [loading, setLoading]   = useState(false);
  const [message, setMessage]   = useState<string | null>(null);
  const [error, setError]       = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true); setError(null); setMessage(null);
    try {
      const { data } = await api.post('/auth/forgot-password', { email });
      setMessage(data.message ?? 'If an account exists for that email, a reset link has been sent.');
    } catch (err: any) {
      setError(err?.response?.data?.message ?? 'Could not send the email - try again in a minute.');
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
          <div className="mb-4 flex items-center gap-2">
            <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-amber-500 text-white">
              <Mail size={18}/>
            </div>
            <div>
              <h1 className="text-lg font-bold">Reset your password</h1>
              <p className="text-xs text-slate-500">Enter the email you sign in with - we'll send a reset link.</p>
            </div>
          </div>

          {message ? (
            <div className="rounded-lg bg-emerald-50 p-4 text-sm text-emerald-700">
              {message}
              <p className="mt-2 text-xs text-emerald-600">
                The link expires in 30 minutes. Check your spam folder if it doesn't arrive in a few minutes.
              </p>
            </div>
          ) : (
            <form onSubmit={submit} className="space-y-3">
              <label className="block">
                <span className="text-xs font-semibold text-slate-700">Email</span>
                <input
                  type="email" required autoFocus autoComplete="email"
                  className="mt-1 w-full rounded-md border border-slate-200 px-3 py-2 text-sm"
                  placeholder="you@fashionfusion.local"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                />
              </label>
              {error && <div className="rounded-md bg-rose-50 p-2 text-xs text-rose-700">{error}</div>}
              <button
                type="submit" disabled={loading || !email.includes('@')}
                className="w-full rounded-md bg-amber-500 py-2 text-sm font-semibold text-white hover:bg-amber-600 disabled:opacity-60"
              >
                {loading ? 'Sending…' : 'Send reset link'}
              </button>
            </form>
          )}
        </div>
      </div>
    </div>
  );
}
