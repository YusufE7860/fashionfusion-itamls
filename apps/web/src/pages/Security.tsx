import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { api } from '@/api/client';
import { PageHeader } from '@/components/PageHeader';
import { ShieldCheck, ShieldOff, Copy } from 'lucide-react';

export function Security() {
  const me = useQuery({ queryKey: ['me'], queryFn: () => api.get('/auth/me').then((r) => r.data) });
  const [setupData, setSetupData] = useState<any>(null);
  const [token, setToken] = useState('');

  const setup = useMutation({
    mutationFn: () => api.post('/auth/2fa/setup').then((r) => r.data),
    onSuccess: (d) => setSetupData(d),
  });
  const verify = useMutation({
    mutationFn: () => api.post('/auth/2fa/verify-and-enable', { token }).then((r) => r.data),
    onSuccess: () => { setSetupData(null); setToken(''); me.refetch(); alert('2FA enabled. Sign out and back in to test it.'); },
    onError: (e: any) => alert(e.response?.data?.message ?? 'Invalid code'),
  });
  const disable = useMutation({
    mutationFn: () => api.post('/auth/2fa/disable').then((r) => r.data),
    onSuccess: () => { me.refetch(); alert('2FA disabled.'); },
  });

  const enabled = me.data?.totpEnabled;

  return (
    <>
      <PageHeader title="Security" subtitle="Two-factor authentication for your account" />

      <div className="card max-w-2xl p-6">
        <div className="mb-4 flex items-center gap-3">
          {enabled
            ? <span className="grid h-10 w-10 place-items-center rounded-full bg-emerald-500/15 text-emerald-300"><ShieldCheck size={20}/></span>
            : <span className="grid h-10 w-10 place-items-center rounded-full bg-rose-500/15 text-rose-300"><ShieldOff size={20}/></span>}
          <div>
            <div className="text-lg font-semibold text-white">Two-factor authentication</div>
            <div className="text-sm text-ink-200">
              {enabled ? 'Enabled — a 6-digit code from your authenticator app is required at sign-in.' : 'Off — strongly recommended for admin accounts.'}
            </div>
          </div>
        </div>

        {!enabled && !setupData && (
          <button className="btn-primary" onClick={() => setup.mutate()} disabled={setup.isPending}>
            {setup.isPending ? 'Generating…' : 'Set up 2FA'}
          </button>
        )}

        {setupData && (
          <div className="mt-2 rounded-md border border-brand-500/30 bg-ink-700/40 p-4">
            <p className="mb-3 text-sm text-ink-100">
              Scan this QR code with <b>Google Authenticator</b>, <b>1Password</b>, <b>Microsoft Authenticator</b>, or any TOTP app:
            </p>
            <div className="flex flex-col items-center gap-3 sm:flex-row sm:items-start">
              <img src={setupData.qrDataUrl} alt="2FA QR" className="h-44 w-44 rounded bg-white p-2" />
              <div className="flex-1 text-sm text-ink-200">
                <p>Or enter this code manually:</p>
                <div className="mt-2 flex items-center gap-2">
                  <code className="flex-1 break-all rounded bg-ink-900/60 px-2 py-1 font-mono text-xs text-brand-300">{setupData.secret}</code>
                  <button className="btn-ghost" onClick={() => navigator.clipboard.writeText(setupData.secret)}>
                    <Copy size={12}/>
                  </button>
                </div>
                <p className="mt-4">Then enter the 6-digit code your app shows to confirm:</p>
                <input className="field mt-2 max-w-[160px] font-mono text-center text-lg tracking-[0.4em]"
                       value={token} maxLength={6}
                       onChange={(e) => setToken(e.target.value.replace(/\D/g, ''))} />
                <button className="btn-primary mt-3" disabled={token.length !== 6 || verify.isPending}
                        onClick={() => verify.mutate()}>
                  {verify.isPending ? 'Verifying…' : 'Verify and enable'}
                </button>
              </div>
            </div>
          </div>
        )}

        {enabled && (
          <button className="btn-ghost mt-2 text-rose-300"
                  onClick={() => { if (confirm('Disable 2FA on your account?')) disable.mutate(); }}>
            <ShieldOff size={14}/>Disable 2FA
          </button>
        )}
      </div>
    </>
  );
}
