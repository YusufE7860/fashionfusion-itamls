import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { PageHeader } from '@/components/PageHeader';
import { useAuth } from '@/store/auth';
import {
  Activity, AlertCircle, ArrowLeft, Check, Cpu, Download, FileText, Film, HardDrive,
  Image as ImageIcon, Monitor, Play, Power, RefreshCw, RotateCw, Terminal, Zap,
} from 'lucide-react';
import clsx from 'clsx';

/**
 * Troubleshooting hub for a single media player. Four tabs:
 *   Overview — live metrics + snapshot thumb + resolution trace
 *   Events   — playback / error log
 *   Commands — remote actions (restart, upload logs, test pattern)
 *   Playback — what should play vs what IS playing
 */
export function SignageDeviceDetail() {
  const { id } = useParams();
  const qc = useQueryClient();
  const hasPerm = useAuth((s) => s.hasPermission);
  const canWrite = hasPerm('stores:write');
  const [tab, setTab] = useState<'overview' | 'events' | 'commands' | 'playback'>('overview');

  const device = useQuery({
    queryKey: ['signage-device', id],
    queryFn: () => api.get(`/signage/devices/${id}`).then((r) => r.data),
    refetchInterval: 5_000,
  });
  const snap = useQuery({
    queryKey: ['signage-snapshot', id],
    queryFn: () => api.get(`/signage/devices/${id}/snapshot`).then((r) => r.data),
    refetchInterval: 3_000,
    enabled: tab === 'overview',
  });

  const requestSnap = useMutation({
    mutationFn: () => api.post(`/signage/devices/${id}/snapshot`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['signage-snapshot', id] }),
  });

  if (!device.data) return <div className="p-6 text-sm text-ink-300">Loading…</div>;
  const d = device.data;
  const latest = d.heartbeats?.[d.heartbeats.length - 1];

  return (
    <>
      <PageHeader
        title={d.name}
        subtitle={`${d.online ? 'Online' : 'Offline'} · ${d.store ? `${d.store.code} — ${d.store.name}` : 'No store'} · ${d.orientation}`}
        actions={
          <Link to="/signage/devices" className="btn-ghost">
            <ArrowLeft size={13}/>Back to list
          </Link>
        }
      />

      <div className="mb-4 flex items-center gap-1 border-b border-ink-500/20">
        {(['overview','events','commands','playback'] as const).map((t) => (
          <button key={t}
            className={clsx(
              'border-b-2 px-4 py-2 text-xs font-medium capitalize transition-colors',
              tab === t ? 'border-brand-500 text-brand-700' : 'border-transparent text-ink-300 hover:text-ink-100',
            )}
            onClick={() => setTab(t)}>
            {t}
          </button>
        ))}
      </div>

      {tab === 'overview' && <OverviewTab d={d} latest={latest} snap={snap.data} requestSnap={() => requestSnap.mutate()} />}
      {tab === 'events'   && <EventsTab id={id!} />}
      {tab === 'commands' && <CommandsTab id={id!} canWrite={canWrite} />}
      {tab === 'playback' && <PlaybackTab id={id!} />}
    </>
  );
}

// ===== Overview tab =====
function OverviewTab({ d, latest, snap, requestSnap }: any) {
  const bytes = (n: any) => n ? `${(Number(n) / 1024 / 1024 / 1024).toFixed(1)} GB` : '—';
  return (
    <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
      <section className="card p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700"><Activity size={14}/>Diagnostics</h3>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
          <Stat icon={<Cpu size={13}/>}   label="CPU"      value={latest?.cpuPct != null ? `${latest.cpuPct.toFixed(0)}%` : '—'} />
          <Stat icon={<Monitor size={13}/>} label="Memory" value={latest?.memUsedPct != null ? `${latest.memUsedPct}%` : '—'} />
          <Stat icon={<HardDrive size={13}/>} label="Disk free" value={d.diskFreePct != null ? `${d.diskFreePct}%` : '—'} />
          <Stat icon={<ImageIcon size={13}/>} label="Resolution" value={latest?.screenWidth ? `${latest.screenWidth}×${latest.screenHeight}` : '—'} />
          <Stat icon={<Play size={13}/>}  label="Player"   value={latest?.playerAlive === false ? 'Not running' : latest?.playerAlive ? 'Running' : '—'} />
          <Stat icon={<Film size={13}/>}  label="Decoder"  value={latest?.decoder ?? '—'} />
          <Stat icon={<Film size={13}/>}  label="mpv"      value={latest?.mpvVersion ?? '—'} />
          <Stat icon={<Zap size={13}/>}   label="Dropped frames" value={latest?.droppedFrames != null ? `${latest.droppedFrames}` : '—'} />
          <Stat icon={<Zap size={13}/>}   label="Audio sink" value={latest?.audioSink ?? '—'} />
        </div>
        {!d.online && (
          <div className="mt-3 flex items-start gap-2 rounded border border-rose-300 bg-rose-50 p-3 text-xs text-rose-700">
            <AlertCircle size={14} className="mt-0.5"/>
            <span>Device hasn't reported in. Last seen {d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString() : 'never'}.</span>
          </div>
        )}
      </section>

      <section className="card p-3">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-700">Current screen</h3>
          <button className="btn-ghost" onClick={requestSnap}><RefreshCw size={11}/></button>
        </div>
        <div className="aspect-video bg-black">
          {snap?.url ? (
            <img src={snap.url} alt="snapshot" className="h-full w-full object-contain"/>
          ) : (
            <div className="flex h-full items-center justify-center text-xs text-ink-300">
              {snap?.pending ? 'Capturing…' : 'No snapshot yet'}
            </div>
          )}
        </div>
        {snap?.snapshotAt && (
          <div className="mt-1 text-[10px] text-ink-300">
            {Math.round((Date.now() - new Date(snap.snapshotAt).getTime()) / 1000)}s ago
          </div>
        )}
      </section>
    </div>
  );
}

// ===== Events tab =====
function EventsTab({ id }: { id: string }) {
  const events = useQuery({
    queryKey: ['signage-events', id],
    queryFn: () => api.get(`/signage/devices/${id}/events`).then((r) => r.data),
    refetchInterval: 5_000,
  });
  return (
    <section className="card p-0">
      <ul className="divide-y divide-ink-500/10 max-h-[70vh] overflow-auto">
        {events.data?.length === 0 && (
          <li className="p-6 text-center text-xs text-ink-300">
            No events logged yet. The agent reports playback starts/ends/errors here.
          </li>
        )}
        {events.data?.map((e: any) => (
          <li key={e.id} className="flex items-start gap-3 p-3 text-xs">
            <span className={clsx(
              'rounded px-1.5 py-0.5 font-mono text-[10px]',
              e.severity === 'ERROR' && 'bg-rose-100 text-rose-700',
              e.severity === 'WARN'  && 'bg-amber-100 text-amber-700',
              e.severity === 'INFO'  && 'bg-slate-100 text-slate-700',
            )}>{e.kind}</span>
            <div className="flex-1">
              <div>{e.message ?? ''}</div>
              {e.metadata && <pre className="mt-1 text-[10px] text-ink-300">{JSON.stringify(e.metadata)}</pre>}
            </div>
            <div className="text-[10px] text-ink-300 whitespace-nowrap">
              {new Date(e.createdAt).toLocaleString()}
            </div>
          </li>
        ))}
      </ul>
    </section>
  );
}

// ===== Commands tab =====
function CommandsTab({ id, canWrite }: { id: string; canWrite: boolean }) {
  const qc = useQueryClient();
  const cmds = useQuery({
    queryKey: ['signage-cmds', id],
    queryFn: () => api.get(`/signage/devices/${id}/commands`).then((r) => r.data),
    refetchInterval: 3_000,
  });
  const run = useMutation({
    mutationFn: (kind: string) => api.post(`/signage/devices/${id}/commands`, { kind }).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['signage-cmds', id] }),
  });

  const buttons: Array<{ kind: string; label: string; icon: any; danger?: boolean; confirm?: string }> = [
    { kind: 'RESTART_MPV',   label: 'Restart player (mpv)', icon: <RotateCw size={12}/> },
    { kind: 'RESTART_AGENT', label: 'Restart agent service', icon: <RefreshCw size={12}/> },
    { kind: 'UPLOAD_LOGS',   label: 'Upload journalctl logs', icon: <FileText size={12}/> },
    { kind: 'TEST_PATTERN',  label: 'Play test pattern', icon: <ImageIcon size={12}/> },
    { kind: 'TEST_AUDIO',    label: 'Play audio test tone', icon: <Zap size={12}/> },
    { kind: 'REBOOT',        label: 'Reboot device', icon: <Power size={12}/>, danger: true, confirm: 'Reboot the player? It will go dark for ~60s.' },
  ];

  async function fetchResult(cmdId: string) {
    try {
      const r = await api.get(`/signage/devices/${id}/commands/${cmdId}/result`);
      if (r.data?.url) window.open(r.data.url, '_blank');
    } catch { /* ignore */ }
  }

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-[320px_1fr]">
      <section className="card p-4">
        <h3 className="mb-3 text-sm font-semibold text-slate-700">Actions</h3>
        {canWrite ? (
          <div className="space-y-1.5">
            {buttons.map((b) => (
              <button key={b.kind}
                className={clsx(
                  'flex w-full items-center gap-2 rounded px-3 py-1.5 text-xs transition-colors',
                  b.danger ? 'border border-rose-200 text-rose-600 hover:bg-rose-50'
                           : 'border border-ink-500/20 text-ink-100 hover:border-brand-400 hover:bg-brand-50/40',
                )}
                onClick={() => {
                  if (b.confirm && !confirm(b.confirm)) return;
                  run.mutate(b.kind);
                }}>
                {b.icon}{b.label}
              </button>
            ))}
          </div>
        ) : <div className="text-xs text-ink-300">You need the stores:write permission to run commands.</div>}
      </section>

      <section className="card p-0">
        <table className="w-full text-xs">
          <thead className="bg-slate-50">
            <tr>
              <th className="th text-left">Command</th>
              <th className="th text-left">Issued</th>
              <th className="th text-left">By</th>
              <th className="th text-left">Status</th>
              <th className="th text-right">Result</th>
            </tr>
          </thead>
          <tbody>
            {cmds.data?.length === 0 && (
              <tr><td colSpan={5} className="py-6 text-center text-ink-300">No commands yet.</td></tr>
            )}
            {cmds.data?.map((c: any) => (
              <tr key={c.id} className="border-b border-ink-500/10">
                <td className="py-2 font-mono">{c.kind}</td>
                <td className="py-2 text-ink-300">{new Date(c.queuedAt).toLocaleTimeString()}</td>
                <td className="py-2">{c.issuedBy?.fullName ?? '—'}</td>
                <td className="py-2">
                  <span className={clsx(
                    'rounded px-1.5 py-0.5 font-mono text-[10px]',
                    c.status === 'DONE'   && 'bg-emerald-100 text-emerald-700',
                    c.status === 'FAILED' && 'bg-rose-100 text-rose-700',
                    (c.status === 'QUEUED' || c.status === 'SENT') && 'bg-amber-100 text-amber-700',
                  )}>{c.status}</span>
                </td>
                <td className="py-2 text-right">
                  {c.resultKey && (
                    <button className="btn-ghost" onClick={() => fetchResult(c.id)}>
                      <Download size={11}/>Download
                    </button>
                  )}
                  {c.resultText && !c.resultKey && (
                    <span className="text-ink-300" title={c.resultText}>
                      {c.resultText.slice(0, 40)}…
                    </span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </div>
  );
}

// ===== Playback / Resolution trace tab =====
function PlaybackTab({ id }: { id: string }) {
  const trace = useQuery({
    queryKey: ['signage-trace', id],
    queryFn: () => api.get(`/signage/devices/${id}/trace`).then((r) => r.data),
    refetchInterval: 10_000,
  });
  const t = trace.data;
  if (!t) return <div className="p-6 text-sm text-ink-300">Loading…</div>;

  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-[1fr_1fr]">
      <section className="card p-4">
        <h3 className="mb-3 text-sm font-semibold text-slate-700">Resolution trace</h3>
        <p className="mb-2 text-xs text-ink-300">
          Why the device is (or isn't) playing what you expect.
        </p>
        <ul className="space-y-2">
          {t.steps.map((s: any, i: number) => (
            <li key={i} className="rounded border border-ink-500/10 p-2 text-xs">
              <div className="font-semibold">{s.step}</div>
              <div className="mt-0.5">→ {s.result}</div>
              {s.detail && <div className="mt-0.5 text-[11px] text-ink-300">{s.detail}</div>}
            </li>
          ))}
        </ul>
        {t.resolved ? (
          <div className="mt-3 rounded border border-emerald-200 bg-emerald-50 p-2 text-xs">
            <Check size={12} className="inline text-emerald-600"/> Playing playlist <b>{t.resolved.name}</b>
            <span className="text-ink-300"> · {t.items.length} items match this device's orientation</span>
          </div>
        ) : (
          <div className="mt-3 rounded border border-amber-200 bg-amber-50 p-2 text-xs">
            <AlertCircle size={12} className="inline text-amber-600"/> No playlist resolved — assign one.
          </div>
        )}
      </section>

      <section className="card p-4">
        <h3 className="mb-3 text-sm font-semibold text-slate-700">Items that should play ({t.items?.length ?? 0})</h3>
        <ol className="space-y-1 text-xs">
          {t.items?.map((it: any) => (
            <li key={it.videoId} className="flex items-center gap-2 rounded border border-ink-500/10 p-1.5">
              <span className="w-5 font-mono text-ink-300">{it.order}</span>
              <span className="flex-1 font-mono">{it.filename}</span>
              <span className="text-[10px] text-ink-300">{it.durationSeconds ?? '—'}s</span>
              <span className="rounded bg-slate-100 px-1 text-[10px]">{it.orientation}</span>
            </li>
          ))}
        </ol>
        {t.skipped?.length > 0 && (
          <>
            <h4 className="mt-4 text-[11px] font-semibold text-ink-300">Skipped (orientation mismatch)</h4>
            <ul className="mt-1 space-y-0.5 text-[11px] text-ink-300">
              {t.skipped.map((s: any) => (
                <li key={s.videoId}>· {s.filename} — {s.reason}</li>
              ))}
            </ul>
          </>
        )}
      </section>
    </div>
  );
}

// ===== small helpers =====
function Stat({ icon, label, value }: any) {
  return (
    <div className="rounded border border-ink-500/10 p-2">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-ink-300">{icon}{label}</div>
      <div className="mt-0.5 truncate text-sm font-semibold text-ink-100">{value}</div>
    </div>
  );
}
