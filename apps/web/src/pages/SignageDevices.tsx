import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { PageHeader } from '@/components/PageHeader';
import { useAuth } from '@/store/auth';
import { Monitor, RefreshCw, RotateCw, Eye, X } from 'lucide-react';
import clsx from 'clsx';

export function SignageDevices() {
  const qc = useQueryClient();
  const hasPerm = useAuth((s) => s.hasPermission);
  const canWrite = hasPerm('stores:write');
  const [viewing, setViewing] = useState<any | null>(null);

  const devices = useQuery({
    queryKey: ['signage-devices'],
    queryFn: () => api.get('/signage/devices').then((r) => r.data),
    refetchInterval: 10_000,
  });
  const stores = useQuery({ queryKey: ['stores'], queryFn: () => api.get('/stores').then((r) => r.data) });

  const update = useMutation({
    mutationFn: ({ id, body }: any) => api.patch(`/signage/devices/${id}`, body).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['signage-devices'] }),
  });
  const resync = useMutation({
    mutationFn: (id: string) => api.post(`/signage/devices/${id}/resync`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['signage-devices'] }),
  });

  const online = devices.data?.filter((d: any) => d.online).length ?? 0;
  const total = devices.data?.length ?? 0;

  return (
    <>
      <PageHeader
        title="Signage — Media players"
        subtitle={`${online} of ${total} players online`}
      />
      <section className="card p-4">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="th text-left">Name</th>
              <th className="th text-left">Store</th>
              <th className="th text-left">Orientation</th>
              <th className="th text-left">Status</th>
              <th className="th text-left">Last seen</th>
              <th className="th text-left">Agent</th>
              <th className="th text-right">Disk free</th>
              <th className="th text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {devices.data?.length === 0 && (
              <tr><td colSpan={8} className="py-6 text-center text-xs text-ink-300">
                No signage devices yet. The agent on a media player enrols itself the first time it connects.
              </td></tr>
            )}
            {devices.data?.map((d: any) => (
              <tr key={d.id} className="border-b border-ink-500/10">
                <td className="py-2">
                  <div className="flex items-center gap-2">
                    <span className={clsx('h-2 w-2 rounded-full', d.online ? 'bg-emerald-500' : 'bg-slate-300')} />
                    <Monitor size={14} className="text-ink-300"/>
                    <Link to={`/signage/devices/${d.id}`} className="font-medium text-brand-700 hover:underline">
                      {d.name}
                    </Link>
                  </div>
                </td>
                <td className="py-2 text-xs">
                  {canWrite ? (
                    <select className="field !py-1 text-xs" value={d.storeId ?? ''}
                      onChange={(e) => update.mutate({ id: d.id, body: { storeId: e.target.value || null } })}>
                      <option value="">— no store —</option>
                      {stores.data?.map((s: any) => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
                    </select>
                  ) : (d.store ? `${d.store.code} — ${d.store.name}` : '—')}
                </td>
                <td className="py-2 text-xs">
                  {canWrite ? (
                    <div className="flex items-center gap-1">
                      <select className="field !py-1 text-xs" value={d.orientation ?? 'LANDSCAPE'}
                        onChange={(e) => update.mutate({ id: d.id, body: { orientation: e.target.value } })}>
                        <option value="LANDSCAPE">Landscape</option>
                        <option value="PORTRAIT">Portrait</option>
                      </select>
                      <button
                        className={clsx(
                          'rounded p-1 ring-1',
                          d.forceRotate90
                            ? 'bg-amber-100 text-amber-700 ring-amber-300'
                            : 'bg-white text-ink-300 ring-ink-500/30 hover:text-amber-600',
                        )}
                        title={d.forceRotate90 ? 'Rotating 90° — click to disable' : 'Force rotate 90° (emergency fallback)'}
                        onClick={() => update.mutate({ id: d.id, body: { forceRotate90: !d.forceRotate90 } })}>
                        <RotateCw size={11}/>
                      </button>
                    </div>
                  ) : (
                    <span>{d.orientation}{d.forceRotate90 && ' (⟲90°)'}</span>
                  )}
                </td>
                <td className="py-2 text-xs">
                  <span className={clsx(
                    'rounded px-1.5 py-0.5 font-mono text-[10px]',
                    d.status === 'ACTIVE'   && 'bg-emerald-100 text-emerald-700',
                    d.status === 'PENDING'  && 'bg-amber-100 text-amber-700',
                    d.status === 'DISABLED' && 'bg-slate-100 text-slate-500',
                  )}>{d.status}</span>
                </td>
                <td className="py-2 text-xs text-ink-300">
                  {d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString() : 'never'}
                </td>
                <td className="py-2 text-xs">{d.agentVersion ?? '—'}</td>
                <td className="py-2 text-right text-xs">
                  {d.diskFreePct != null ? `${d.diskFreePct}%` : '—'}
                </td>
                <td className="py-2 text-right">
                  <div className="flex justify-end gap-1">
                    {canWrite && d.status === 'PENDING' && (
                      <button className="btn-ghost text-emerald-600" onClick={() => update.mutate({ id: d.id, body: { status: 'ACTIVE' } })}>
                        Approve
                      </button>
                    )}
                    <button className="btn-ghost" title="See what's playing now"
                      onClick={() => setViewing(d)}>
                      <Eye size={12}/>View
                    </button>
                    {canWrite && (
                      <button className="btn-ghost" title="Force the agent to purge its cache and re-download"
                        onClick={() => { if (confirm('Force resync?')) resync.mutate(d.id); }}>
                        <RefreshCw size={12}/>
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      {viewing && <PeekModal device={viewing} onClose={() => setViewing(null)} />}
    </>
  );
}

// =========================================================================
//  PeekModal — ask the agent for a snapshot and show it, auto-refreshing
// =========================================================================
function PeekModal({ device, onClose }: { device: any; onClose: () => void }) {
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastRequestedAt, setLastRequestedAt] = useState<number>(0);

  const snap = useQuery({
    queryKey: ['signage-snapshot', device.id],
    queryFn: () => api.get(`/signage/devices/${device.id}/snapshot`).then((r) => r.data),
    refetchInterval: 2_000,
  });

  const request = useMutation({
    mutationFn: () => api.post(`/signage/devices/${device.id}/snapshot`).then((r) => r.data),
    onSuccess: () => setLastRequestedAt(Date.now()),
  });

  // Trigger a new snapshot every ~6s while the modal is open and auto-refresh on
  useEffect(() => {
    if (!autoRefresh) return;
    request.mutate();
    const t = setInterval(() => request.mutate(), 6_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh, device.id]);

  const snapAge = snap.data?.snapshotAt
    ? Math.round((Date.now() - new Date(snap.data.snapshotAt).getTime()) / 1000)
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="relative max-h-[90vh] max-w-5xl overflow-hidden rounded-lg bg-slate-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 border-b border-slate-700 bg-slate-800 px-4 py-2">
          <div>
            <div className="text-sm font-semibold text-white">{device.name}</div>
            <div className="text-[11px] text-slate-400">
              {device.online ? 'Online' : 'Offline'} ·
              {snap.data?.pending && ' Capturing…'}
              {snapAge !== null && !snap.data?.pending && ` Snapshot ${snapAge}s ago`}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1 text-[11px] text-slate-200">
              <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)}/>
              Auto-refresh
            </label>
            <button className="btn-ghost text-slate-100 hover:text-white"
              disabled={request.isPending}
              onClick={() => request.mutate()}>
              <RefreshCw size={12}/>Refresh
            </button>
            <button className="btn-ghost text-slate-100 hover:text-white" onClick={onClose}>
              <X size={14}/>
            </button>
          </div>
        </div>

        <div className="flex min-h-[320px] items-center justify-center bg-black">
          {snap.data?.url ? (
            <img src={snap.data.url} alt="Current screen" className="max-h-[80vh] max-w-full object-contain" />
          ) : snap.data?.pending ? (
            <div className="p-8 text-center text-sm text-slate-300">
              <div className="animate-pulse">Waiting for the player to capture…</div>
              <div className="mt-2 text-[11px] text-slate-500">Takes a few seconds — the agent only checks the server every 30s or so.</div>
            </div>
          ) : (
            <div className="p-8 text-center text-sm text-slate-400">
              No snapshot yet. Click Refresh to request one.
            </div>
          )}
        </div>

        {!device.online && (
          <div className="bg-rose-950/60 px-4 py-2 text-xs text-rose-200">
            This player is offline — snapshots won't update until it reconnects.
          </div>
        )}
      </div>
    </div>
  );
}
