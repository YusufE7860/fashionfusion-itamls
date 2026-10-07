import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { PageHeader } from '@/components/PageHeader';
import { Activity, Cpu, HardDrive, Monitor, Power, Terminal, Zap } from 'lucide-react';
import clsx from 'clsx';

/**
 * RMM — Remote Monitoring & Management.
 *
 * Phase 1 scope: list online PCs, open a detail view, see metrics, run
 * PowerShell / cmd scripts, restart, view command history.
 *
 * Phase 3 adds remote desktop (WebRTC) — not in this screen yet.
 */
export function Rmm() {
  const conns = useQuery({
    queryKey: ['rmm-connections'],
    queryFn: () => api.get('/rmm/connections').then((r) => r.data),
    refetchInterval: 5_000,
  });

  const [selected, setSelected] = useState<string | null>(null);
  const online = conns.data?.filter((c: any) => c.isOnline).length ?? 0;
  const total  = conns.data?.length ?? 0;

  return (
    <>
      <PageHeader
        title="RMM"
        subtitle={`${online} of ${total} agents online`}
      />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]">
        <section className="card p-0">
          <ul className="max-h-[70vh] divide-y divide-ink-500/10 overflow-auto">
            {conns.data?.length === 0 && (
              <li className="p-6 text-center text-sm text-ink-300">
                No agents have connected yet. Install the updated agent on a PC and it will register here.
              </li>
            )}
            {conns.data?.map((c: any) => (
              <li key={c.id}>
                <button className={clsx(
                  'flex w-full items-center gap-2 px-3 py-2 text-left transition-colors',
                  selected === c.agentPcId ? 'bg-brand-50' : 'hover:bg-slate-50',
                )}
                  onClick={() => setSelected(c.agentPcId)}>
                  <span className={clsx(
                    'inline-block h-2 w-2 shrink-0 rounded-full',
                    c.isOnline ? 'bg-emerald-500' : 'bg-slate-300',
                  )} />
                  <div className="flex-1">
                    <div className="truncate text-sm font-semibold">{c.osName ?? c.agentPcId.slice(0, 8)}</div>
                    <div className="text-[10px] text-ink-300">
                      {c.isOnline ? 'Online' : `Last seen ${new Date(c.lastSeenAt).toLocaleString()}`}
                    </div>
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </section>
        <section className="min-h-[400px]">
          {selected ? <PcDetail agentPcId={selected} /> : <div className="card p-6 text-center text-sm text-ink-300">Pick a PC on the left.</div>}
        </section>
      </div>
    </>
  );
}

function PcDetail({ agentPcId }: { agentPcId: string }) {
  const qc = useQueryClient();
  const info = useQuery({
    queryKey: ['rmm-pc', agentPcId],
    queryFn: () => api.get(`/rmm/pcs/${agentPcId}`).then((r) => r.data),
    refetchInterval: 5_000,
  });
  const metrics = useQuery({
    queryKey: ['rmm-metrics', agentPcId],
    queryFn: () => api.get(`/rmm/pcs/${agentPcId}/metrics`, { params: { limit: 30 } }).then((r) => r.data),
    refetchInterval: 5_000,
  });
  const history = useQuery({
    queryKey: ['rmm-cmds', agentPcId],
    queryFn: () => api.get(`/rmm/pcs/${agentPcId}/commands`).then((r) => r.data),
    refetchInterval: 3_000,
  });

  const [script, setScript] = useState('Get-Service | Where-Object Status -eq "Running" | Select Name,DisplayName -First 10');
  const runShell = useMutation({
    mutationFn: () => api.post(`/rmm/pcs/${agentPcId}/shell`, { script, interpreter: 'POWERSHELL' }).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rmm-cmds', agentPcId] }),
  });
  const restart = useMutation({
    mutationFn: () => api.post(`/rmm/pcs/${agentPcId}/restart`, { delaySeconds: 10 }).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rmm-cmds', agentPcId] }),
  });

  const latest = metrics.data?.[0];
  const bytes = (n: any) => n ? `${(Number(n) / 1024 / 1024 / 1024).toFixed(1)} GB` : '—';

  return (
    <div className="space-y-4">
      {/* Header: live status + quick actions */}
      <section className="card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className={clsx(
                'inline-block h-2.5 w-2.5 rounded-full',
                info.data?.live ? 'bg-emerald-500' : 'bg-slate-300',
              )} />
              <h2 className="text-lg font-semibold">{info.data?.osName ?? agentPcId.slice(0, 10)}</h2>
            </div>
            <div className="mt-0.5 text-xs text-ink-300">
              {info.data?.osVersion} · agent {info.data?.agentVersion ?? '—'} · {info.data?.localIp ?? '—'}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button className="btn-ghost" disabled={!info.data?.live || restart.isPending}
              onClick={() => { if (confirm('Restart this PC in 10 seconds?')) restart.mutate(); }}>
              <Power size={13}/>Restart
            </button>
          </div>
        </div>
      </section>

      {/* Live metrics */}
      <section className="card p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700"><Activity size={14}/>Metrics</h3>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatBox icon={<Cpu size={14}/>} label="CPU" value={latest?.cpuPct != null ? `${latest.cpuPct.toFixed(0)}%` : '—'} />
          <StatBox icon={<Monitor size={14}/>} label="Memory"
            value={latest?.memUsedBytes ? `${bytes(latest.memUsedBytes)} / ${bytes(latest.memTotalBytes)}` : '—'} />
          <StatBox icon={<HardDrive size={14}/>} label="Disk"
            value={latest?.diskUsedBytes ? `${bytes(latest.diskUsedBytes)} / ${bytes(latest.diskTotalBytes)}` : '—'} />
          <StatBox icon={<Activity size={14}/>} label="User" value={latest?.loggedInUser ?? '—'} />
        </div>
        {/* Tiny CPU sparkline */}
        <div className="mt-4 h-16">
          <Sparkline values={(metrics.data ?? []).slice().reverse().map((m: any) => m.cpuPct ?? 0)} />
        </div>
        <p className="mt-1 text-[11px] text-ink-300">CPU % over the last ~5 minutes</p>
      </section>

      {/* Shell */}
      <section className="card p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700"><Terminal size={14}/>Remote PowerShell</h3>
        <textarea className="field font-mono text-xs" rows={5}
          value={script} onChange={(e) => setScript(e.target.value)} />
        <div className="mt-2 flex items-center gap-2">
          <button className="btn-primary" disabled={!info.data?.live || runShell.isPending}
            onClick={() => runShell.mutate()}>
            <Zap size={13}/>{runShell.isPending ? 'Running…' : 'Run'}
          </button>
          {!info.data?.live && <span className="text-xs text-amber-600">Agent is offline — command will queue until it reconnects.</span>}
        </div>
      </section>

      {/* Command history */}
      <section className="card p-4">
        <h3 className="mb-3 text-sm font-semibold text-slate-700">Command history</h3>
        <ul className="space-y-1 text-xs">
          {(history.data ?? []).length === 0 && <li className="text-ink-300">No commands yet.</li>}
          {history.data?.map((c: any) => (
            <li key={c.id} className="rounded border border-ink-500/10 bg-slate-50/40 p-2">
              <div className="mb-1 flex items-center justify-between">
                <span className="font-mono text-[10px]">{c.kind} · {c.status}</span>
                <span className="text-[10px] text-ink-300">
                  {new Date(c.queuedAt).toLocaleTimeString()} · {c.issuedBy?.fullName ?? ''}
                </span>
              </div>
              {c.kind === 'SHELL' && (
                <pre className="max-h-20 overflow-auto whitespace-pre-wrap font-mono text-[10px] text-ink-200">
                  {(c.payload as any)?.script?.slice(0, 300) ?? ''}
                </pre>
              )}
              {(c.stdout || c.stderr) && (
                <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[10px]">
                  {c.stdout}{c.stderr && <span className="text-rose-500">{'\n' + c.stderr}</span>}
                </pre>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

function StatBox({ icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="rounded border border-ink-500/10 p-2">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-ink-300">{icon}{label}</div>
      <div className="mt-0.5 text-sm font-semibold text-ink-100 truncate">{value}</div>
    </div>
  );
}

function Sparkline({ values }: { values: number[] }) {
  const max = Math.max(100, ...values);
  const points = values.map((v, i) => `${(i / Math.max(1, values.length - 1)) * 100},${100 - (v / max) * 100}`).join(' ');
  return (
    <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
      <polyline fill="none" stroke="#fe6620" strokeWidth="1.5" points={points} vectorEffect="non-scaling-stroke"/>
    </svg>
  );
}
