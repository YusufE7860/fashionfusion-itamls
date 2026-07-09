import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { PageHeader } from '@/components/PageHeader';
import { useAuth } from '@/store/auth';
import { Plus, X } from 'lucide-react';

export function StockByLocation() {
  const qc = useQueryClient();
  const hasPerm = useAuth((s) => s.hasPermission);
  const [showNew, setShowNew] = useState(false);

  const stock = useQuery({ queryKey: ['stock'], queryFn: () => api.get('/stock').then((r) => r.data) });
  const skus      = useQuery({ queryKey: ['skus'],      queryFn: () => api.get('/skus').then((r) => r.data),      enabled: showNew });
  const locations = useQuery({ queryKey: ['locations'], queryFn: () => api.get('/locations').then((r) => r.data), enabled: showNew });

  const [form, setForm] = useState({ skuId: '', locationId: '', qtyOnHand: 0, reorderLevel: 0 });

  const upsert = useMutation({
    mutationFn: () => api.post('/stock', form).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stock'] });
      setShowNew(false);
      setForm({ skuId: '', locationId: '', qtyOnHand: 0, reorderLevel: 0 });
    },
    onError: (e: any) => alert(e.response?.data?.message ?? 'Save failed'),
  });

  return (
    <>
      <PageHeader
        title="Stock by Location"
        subtitle="Non-serialised stock ledger (accessories, consumables)"
        actions={hasPerm('stock:write') &&
          <button className="btn-primary" onClick={() => setShowNew(!showNew)}>
            {showNew ? <><X size={14}/>Cancel</> : <><Plus size={14}/>Add / update stock</>}
          </button>}
      />

      {showNew && (
        <div className="card mb-4 p-4">
          <h3 className="mb-3 text-sm font-semibold text-white">Set stock level</h3>
          <div className="grid grid-cols-4 gap-3">
            <div className="col-span-2"><label className="label">SKU</label>
              <select className="field" value={form.skuId} onChange={(e) => setForm({ ...form, skuId: e.target.value })}>
                <option value="">Pick a SKU…</option>
                {skus.data?.filter((s: any) => !s.isSerialised).map((s: any) =>
                  <option key={s.id} value={s.id}>{s.code} – {s.name}</option>)}
              </select>
              <p className="mt-1 text-[11px] text-ink-200">Only non-serialised SKUs appear here.</p></div>
            <div><label className="label">Location</label>
              <select className="field" value={form.locationId} onChange={(e) => setForm({ ...form, locationId: e.target.value })}>
                <option value="">Pick…</option>
                {locations.data?.map((l: any) => <option key={l.id} value={l.id}>{l.code} – {l.name}</option>)}
              </select></div>
            <div><label className="label">Qty on hand</label>
              <input type="number" min={0} className="field" value={form.qtyOnHand}
                     onChange={(e) => setForm({ ...form, qtyOnHand: +e.target.value })} /></div>
            <div><label className="label">Reorder level</label>
              <input type="number" min={0} className="field" value={form.reorderLevel}
                     onChange={(e) => setForm({ ...form, reorderLevel: +e.target.value })} /></div>
          </div>
          <button className="btn-primary mt-3" disabled={!form.skuId || !form.locationId || upsert.isPending}
                  onClick={() => upsert.mutate()}>
            {upsert.isPending ? 'Saving…' : 'Save stock level'}
          </button>
        </div>
      )}

      <div className="card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr>
              <th className="th">Location</th><th className="th">SKU</th><th className="th">Name</th>
              <th className="th text-right">On hand</th><th className="th text-right">Reorder</th>
            </tr>
          </thead>
          <tbody>
            {stock.data?.map((s: any) => (
              <tr key={s.id} className="border-t border-ink-500/30">
                <td className="td">{s.location?.name}</td>
                <td className="td font-mono">{s.sku?.code}</td>
                <td className="td">{s.sku?.name}</td>
                <td className="td text-right font-mono">{s.qtyOnHand}</td>
                <td className="td text-right font-mono">{s.reorderLevel}</td>
              </tr>
            ))}
            {(!stock.data || stock.data.length === 0) && (
              <tr><td className="td" colSpan={5}>No non-serialised stock yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
