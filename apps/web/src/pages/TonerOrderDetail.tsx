import { useState, useMemo } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { PageHeader } from '@/components/PageHeader';
import { Pill } from '@/components/Pill';
import { useAuth } from '@/store/auth';
import { Truck, Check, X } from 'lucide-react';
import clsx from 'clsx';

export function TonerOrderDetail() {
  const { id } = useParams();
  const qc = useQueryClient();
  const hasPerm = useAuth((s) => s.hasPermission);
  const order = useQuery({
    queryKey: ['toner-order', id],
    queryFn: () => api.get(`/toner/orders/${id}`).then((r) => r.data),
    enabled: !!id,
  });

  const [dispatchFor, setDispatchFor] = useState<string | null>(null);
  const [courier, setCourier] = useState('');
  const [trackingNo, setTrackingNo] = useState('');
  const [boxNumbers, setBoxNumbers] = useState('');

  const dispatchStore = useMutation({
    mutationFn: ({ storeId }: { storeId: string }) =>
      api.post(`/toner/orders/${id}/stores/${storeId}/dispatch`, { dispatchedQty: 0, courier, trackingNo, boxNumbers }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['toner-order', id] });
      setDispatchFor(null); setCourier(''); setTrackingNo(''); setBoxNumbers('');
    },
  });

  const dispatchLine = useMutation({
    mutationFn: ({ lineId, qty }: { lineId: string; qty: number }) =>
      api.post(`/toner/orders/lines/${lineId}/dispatch`, { dispatchedQty: qty }).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['toner-order', id] }),
  });

  const close = useMutation({
    mutationFn: () => api.post(`/toner/orders/${id}/close`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['toner-order', id] }),
  });
  const cancel = useMutation({
    mutationFn: () => api.post(`/toner/orders/${id}/cancel`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['toner-order', id] }),
  });

  // Group lines by store
  const byStore = useMemo(() => {
    if (!order.data) return [] as { storeId: string; storeCode: string; storeName: string; entity: string; lines: any[] }[];
    const m = new Map<string, any>();
    for (const l of order.data.lines) {
      const key = l.storeId;
      const e = m.get(key) ?? { storeId: key, storeCode: l.store.code, storeName: l.store.name, entity: l.store.entity, lines: [] };
      e.lines.push(l);
      m.set(key, e);
    }
    return [...m.values()].sort((a, b) => a.storeCode.localeCompare(b.storeCode));
  }, [order.data]);

  if (!order.data) return <div>Loading…</div>;

  return (
    <>
      <PageHeader
        title={`${order.data.code} — ${order.data.period}`}
        subtitle={`${order.data.lines.length} line(s) across ${byStore.length} store(s)`}
        actions={
          <>
            <Pill status={order.data.status} />
            {order.data.status !== 'CLOSED' && order.data.status !== 'CANCELLED' && (
              <>
                <button className="btn-ghost" onClick={() => close.mutate()}>Close</button>
                <button className="btn-ghost text-rose-300" onClick={() => cancel.mutate()}>Cancel</button>
              </>
            )}
          </>
        }
      />

      {dispatchFor && (
        <div className="card mb-4 p-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white"><Truck size={16}/>Dispatch all toners for this store</h3>
          <div className="grid grid-cols-3 gap-3">
            <div><label className="label">Courier</label>
              <input className="field" value={courier} onChange={(e) => setCourier(e.target.value)} placeholder="e.g. Aramex" /></div>
            <div><label className="label">Tracking number</label>
              <input className="field" value={trackingNo} onChange={(e) => setTrackingNo(e.target.value)} /></div>
            <div><label className="label">Box number(s)</label>
              <input className="field" value={boxNumbers} onChange={(e) => setBoxNumbers(e.target.value)} placeholder="e.g. BOX-001" /></div>
          </div>
          <div className="mt-3 flex gap-2">
            <button className="btn-primary" onClick={() => dispatchStore.mutate({ storeId: dispatchFor })}>
              <Check size={14}/>Confirm dispatch
            </button>
            <button className="btn-ghost" onClick={() => setDispatchFor(null)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="space-y-3">
        {byStore.map((s) => {
          const planned    = s.lines.reduce((sum: number, l: any) => sum + l.plannedQty, 0);
          const dispatched = s.lines.reduce((sum: number, l: any) => sum + l.dispatchedQty, 0);
          const received   = s.lines.reduce((sum: number, l: any) => sum + l.receivedQty, 0);
          const fullyDispatched = dispatched >= planned;
          return (
            <div key={s.storeId} className="card overflow-hidden">
              <header className="flex items-center justify-between border-b border-ink-500/40 px-5 py-3">
                <div>
                  <div className="flex items-center gap-2">
                    <span className="pill-brand">{s.entity === 'EVLV' ? 'EVLV' : 'FF'}</span>
                    <span className="font-mono text-xs text-ink-200">{s.storeCode}</span>
                    <span className="font-semibold text-white">{s.storeName}</span>
                  </div>
                  <div className="mt-0.5 text-xs text-ink-200">
                    Planned <b className="text-white">{planned}</b> · Dispatched <b className={clsx(fullyDispatched ? 'text-emerald-300' : 'text-amber-300')}>{dispatched}</b> · Received <b className="text-white">{received}</b>
                  </div>
                </div>
                {!fullyDispatched && hasPerm('toner:order:dispatch') && (
                  <button className="btn-primary" onClick={() => setDispatchFor(s.storeId)}>
                    <Truck size={14}/>Dispatch
                  </button>
                )}
              </header>
              <table className="w-full">
                <thead>
                  <tr>
                    <th className="th">Toner</th>
                    <th className="th text-right">Planned</th>
                    <th className="th text-right">Dispatched</th>
                    <th className="th text-right">Received</th>
                    <th className="th">Courier</th>
                    <th className="th">Tracking</th>
                    <th className="th">Boxes</th>
                  </tr>
                </thead>
                <tbody>
                  {s.lines.map((l: any) => (
                    <tr key={l.id} className="border-t border-ink-500/30">
                      <td className="td font-mono">{l.tonerType.code} <span className="text-xs text-ink-200">{l.tonerType.manufacturer}</span></td>
                      <td className="td text-right font-mono">{l.plannedQty}</td>
                      <td className="td text-right font-mono">
                        <input type="number" min={0} className="field w-20 text-right font-mono" defaultValue={l.dispatchedQty}
                          onBlur={(e) => {
                            const v = Math.max(0, +e.target.value);
                            if (v !== l.dispatchedQty) dispatchLine.mutate({ lineId: l.id, qty: v });
                          }} />
                      </td>
                      <td className="td text-right font-mono">{l.receivedQty}</td>
                      <td className="td">{l.courier ?? '—'}</td>
                      <td className="td font-mono text-xs">{l.trackingNo ?? '—'}</td>
                      <td className="td font-mono text-xs">{l.boxNumbers ?? '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          );
        })}
        {byStore.length === 0 && (
          <div className="card p-6 text-center text-sm text-ink-200">
            <X size={20} className="mx-auto mb-2 text-ink-200"/>
            No lines on this order. Check that the plan has quantities for the selected month.
          </div>
        )}
      </div>
    </>
  );
}
