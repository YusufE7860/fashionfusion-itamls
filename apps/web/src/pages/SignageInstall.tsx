import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { PageHeader } from '@/components/PageHeader';
import { Check, Copy, Cpu, Monitor, Terminal } from 'lucide-react';
import clsx from 'clsx';

/**
 * Signage agent installer wizard.
 * Pick a platform + optional device name/store code → get a one-liner curl
 * command to paste on the target machine.
 */
export function SignageInstall() {
  const [platform, setPlatform] = useState<'pi' | 'ubuntu-desktop' | 'ubuntu-console'>('pi');
  const [name, setName] = useState('');
  const [storeCode, setStoreCode] = useState('');
  const [copied, setCopied] = useState<string | null>(null);

  const stores = useQuery({ queryKey: ['stores'], queryFn: () => api.get('/stores').then((r) => r.data).catch(() => []) });

  const base = (api.defaults.baseURL ?? '').replace(/\/$/, '');
  const url = useMemo(() => {
    const params = new URLSearchParams();
    params.set('platform', platform);
    if (name.trim()) params.set('name', name.trim());
    if (storeCode) params.set('storeCode', storeCode);
    return `${base}/signage/installer.sh?${params.toString()}`;
  }, [platform, name, storeCode, base]);

  const oneLiner = `curl -fsSL "${url}" | sudo bash`;

  function copy(text: string, which: string) {
    navigator.clipboard.writeText(text);
    setCopied(which);
    setTimeout(() => setCopied(null), 1500);
  }

  const platforms = [
    { id: 'pi' as const,              label: 'Raspberry Pi OS',  icon: <Cpu size={16}/>,     hint: 'Pi 3/4/5 with the desktop OS' },
    { id: 'ubuntu-desktop' as const,  label: 'Ubuntu Desktop',   icon: <Monitor size={16}/>, hint: 'Any x86 or ARM box with a graphical session' },
    { id: 'ubuntu-console' as const,  label: 'Ubuntu Server/Console', icon: <Terminal size={16}/>, hint: 'No X — mpv draws to DRM/KMS directly' },
  ];

  return (
    <>
      <PageHeader
        title="Install signage agent"
        subtitle="Generate an installer command for a new media player"
      />

      <section className="card mb-4 p-4">
        <label className="label">1. Pick platform</label>
        <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
          {platforms.map((p) => (
            <button key={p.id}
              className={clsx(
                'rounded-lg border p-3 text-left transition-colors',
                platform === p.id
                  ? 'border-brand-500 bg-brand-50 ring-2 ring-brand-400'
                  : 'border-ink-500 bg-white hover:border-brand-400 hover:bg-brand-50/40',
              )}
              onClick={() => setPlatform(p.id)}>
              <div className="flex items-center gap-2">
                {p.icon}
                <div className="text-sm font-semibold">{p.label}</div>
              </div>
              <div className="mt-1 text-xs text-ink-300">{p.hint}</div>
            </button>
          ))}
        </div>
      </section>

      <section className="card mb-4 p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <label className="label">2. Device name (optional)</label>
            <input className="field" placeholder="e.g. Store 012 Front Window"
              value={name} onChange={(e) => setName(e.target.value)} />
            <p className="mt-1 text-[11px] text-ink-300">If blank, the device's hostname is used.</p>
          </div>
          <div>
            <label className="label">3. Store to pre-assign (optional)</label>
            <select className="field" value={storeCode}
              onChange={(e) => setStoreCode(e.target.value)}>
              <option value="">— assign later in the dashboard —</option>
              {stores.data?.map((s: any) => (
                <option key={s.id} value={s.code}>{s.code} — {s.name}</option>
              ))}
            </select>
            <p className="mt-1 text-[11px] text-ink-300">You can also assign it after enrolment.</p>
          </div>
        </div>
      </section>

      <section className="card mb-4 p-4">
        <h3 className="mb-2 text-sm font-semibold text-slate-700">4. Run this on the device</h3>
        <p className="mb-2 text-xs text-ink-300">
          Open a terminal on the Pi / Ubuntu box and paste:
        </p>
        <div className="group relative">
          <pre className="whitespace-pre-wrap break-all rounded-lg bg-slate-900 p-3 pr-10 font-mono text-xs text-slate-100">
{oneLiner}
          </pre>
          <button className="absolute right-2 top-2 rounded bg-white/90 p-1 opacity-0 ring-1 ring-ink-500/30 transition-opacity group-hover:opacity-100 hover:bg-brand-50"
            onClick={() => copy(oneLiner, 'one')}>
            {copied === 'one' ? <Check size={12} className="text-emerald-600"/> : <Copy size={12}/>}
          </button>
        </div>

        <details className="mt-3 text-xs text-ink-300">
          <summary className="cursor-pointer">Advanced — download the script to inspect first</summary>
          <p className="mt-1">You can preview the script before piping to bash:</p>
          <div className="group relative mt-1">
            <pre className="rounded bg-slate-100 p-2 font-mono text-[10px]">curl -fsSL "{url}" | less</pre>
            <button className="absolute right-1 top-1 rounded bg-white p-1 opacity-0 ring-1 ring-ink-500/20 transition-opacity group-hover:opacity-100 hover:bg-brand-50"
              onClick={() => copy(`curl -fsSL "${url}" | less`, 'preview')}>
              {copied === 'preview' ? <Check size={10} className="text-emerald-600"/> : <Copy size={10}/>}
            </button>
          </div>
        </details>

        <div className="mt-4 rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
          <b>What happens next:</b> the agent self-enrols on first start. It will appear in
          <b> Signage → Media Players</b> with status <code>PENDING</code>. Click <b>Approve</b>
          to activate it, assign it to a store, and playback begins once a playlist is linked
          to that store (or the device directly).
        </div>
      </section>
    </>
  );
}
