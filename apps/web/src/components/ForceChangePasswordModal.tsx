import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api } from '@/api/client';
import { useAuth } from '@/store/auth';
import { KeyRound, ShieldAlert } from 'lucide-react';

/**
 * Blocking modal shown when the logged-in user has mustChangePassword=true
 * (set by the API when an admin creates the user or resets their password).
 * Cannot be dismissed except by successfully changing the password.
 */
export function ForceChangePasswordModal() {
  const user = useAuth((s) => s.user);
  const clear = useAuth((s) => s.clearMustChangePassword);
  const logout = useAuth((s) => s.logout);

  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');

  const change = useMutation({
    mutationFn: () => api.post('/auth/change-password', {
      currentPassword: current, newPassword: next,
    }).then((r) => r.data),
    onSuccess: () => { clear(); setCurrent(''); setNext(''); setConfirm(''); },
  });

  if (!user?.mustChangePassword) return null;

  const mismatch = next && confirm && next !== confirm;
  const tooShort = next.length > 0 && next.length < 8;
  const disabled = !current || !next || !confirm || mismatch || tooShort || change.isPending;

  return (
    <div className="fixed inset-0 z-[100] grid place-items-center bg-black/60 p-4 backdrop-blur-sm">
      <div className="w-full max-w-md rounded-xl bg-white p-6 shadow-2xl">
        <div className="mb-4 flex items-start gap-3">
          <div className="grid h-10 w-10 place-items-center rounded-full bg-amber-100">
            <ShieldAlert size={20} className="text-amber-600" />
          </div>
          <div>
            <h2 className="text-lg font-semibold text-ink-50">Change your password</h2>
            <p className="mt-1 text-xs text-ink-300">
              Your password was set by an administrator. Please choose a new one before continuing.
            </p>
          </div>
        </div>

        <div className="space-y-3">
          <div>
            <label className="label">Current password</label>
            <input type="password" className="field" autoFocus autoComplete="current-password"
              value={current} onChange={(e) => setCurrent(e.target.value)} />
          </div>
          <div>
            <label className="label">New password (min 8 chars)</label>
            <input type="password" className="field" autoComplete="new-password"
              value={next} onChange={(e) => setNext(e.target.value)} />
            {tooShort && <p className="mt-1 text-xs text-rose-600">Must be at least 8 characters.</p>}
          </div>
          <div>
            <label className="label">Confirm new password</label>
            <input type="password" className="field" autoComplete="new-password"
              value={confirm} onChange={(e) => setConfirm(e.target.value)} />
            {mismatch && <p className="mt-1 text-xs text-rose-600">Passwords don't match.</p>}
          </div>
        </div>

        {change.isError && (
          <div className="mt-3 rounded border border-rose-200 bg-rose-50 p-2 text-xs text-rose-700">
            {(change.error as any)?.response?.data?.message ?? 'Failed to change password.'}
          </div>
        )}

        <div className="mt-5 flex items-center justify-between gap-2">
          <button className="text-xs text-ink-300 hover:text-ink-50 hover:underline" onClick={logout}>
            Sign out instead
          </button>
          <button className="btn-primary" disabled={disabled} onClick={() => change.mutate()}>
            <KeyRound size={14} />{change.isPending ? 'Updating…' : 'Change password'}
          </button>
        </div>
      </div>
    </div>
  );
}
