import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { PageHeader } from '@/components/PageHeader';
import { useAuth } from '@/store/auth';
import { Monitor, RefreshCw } from 'lucide-react';
import clsx from 'clsx';

export function SignageDevices() {
  const qc = useQueryClient();
  const hasPerm = useAuth((s) => s.hasPermission);
  const canWrite = hasPerm('stores:write');

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
              <th className="th text-left">Status</th>
              <th className="th text-left">Last seen</th>
              <th className="th text-left">Agent</th>
              <th className="th text-right">Disk free</th>
              <th className="th text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {devices.data?.length === 0 && (
              <tr><td colSpan={7} className="py-6 text-center text-xs text-ink-300">
                No signage devices yet. The agent on a media player enrols itself the first time it connects.
              </td></tr>
            )}
            {devices.data?.map((d: any) => (
              <tr key={d.id} className="border-b border-ink-500/10">
                <td className="py-2">
                  <div className="flex items-center gap-2">
                    <span className={clsx('h-2 w-2 rounded-full', d.online ? 'bg-emerald-500' : 'bg-slate-300')} />
                    <Monitor size={14} className="text-ink-300"/>
                    <span className="font-medium">{d.name}</span>
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
    </>
  );
}
