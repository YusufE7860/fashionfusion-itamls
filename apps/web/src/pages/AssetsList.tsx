import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { PageHeader } from '@/components/PageHeader';
import { Pill } from '@/components/Pill';
import { useAuth } from '@/store/auth';
import { formatZAR } from '@itamls/shared';
import { Plus, X } from 'lucide-react';

export function AssetsList() {
  const qc = useQueryClient();
  const hasPerm = useAuth((s) => s.hasPermission);
  const [q, setQ] = useState('');
  const [showNew, setShowNew] = useState(false);

  const assets = useQuery({
    queryKey: ['assets', q],
    queryFn: () => api.get('/assets', { params: q ? { q } : {} }).then((r) => r.data),
  });
  const skus      = useQuery({ queryKey: ['skus'],      queryFn: () => api.get('/skus').then((r) => r.data),      enabled: showNew });
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: () => api.get('/suppliers').then((r) => r.data), enabled: showNew });
  const locations = useQuery({ queryKey: ['locations'], queryFn: () => api.get('/locations').then((r) => r.data), enabled: showNew });

  const [form, setForm] = useState({
    assetTag: '', serialNo: '', skuId: '', supplierId: '', locationId: '',
    purchaseDate: new Date().toISOString().slice(0, 10),
    purchaseCostCents: 0, warrantyExpiry: '', condition: 'GOOD',
  });

  const create = useMutation({
    mutationFn: () => api.post('/assets', {
      ...form,
      supplierId: form.supplierId || undefined,
      locationId: form.locationId || undefined,
      warrantyExpiry: form.warrantyExpiry || undefined,
    }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['assets'] });
      setShowNew(false);
      setForm({ assetTag: '', serialNo: '', skuId: '', supplierId: '', locationId: '',
                purchaseDate: new Date().toISOString().slice(0, 10),
                purchaseCostCents: 0, warrantyExpiry: '', condition: 'GOOD' });
    },
    onError: (e: any) => alert(e.response?.data?.message ?? 'Create failed'),
  });

  return (
    <>
      <PageHeader
        title="Assets"
        subtitle="All serialised IT assets across the group"
        actions={hasPerm('assets:write') &&
          <button className="btn-primary" onClick={() => setShowNew(!showNew)}>
            {showNew ? <><X size={14}/>Cancel</> : <><Plus size={14}/>New asset</>}
          </button>}
      />

      {showNew && (
        <div className="card mb-4 p-4">
          <h3 className="mb-3 text-sm font-semibold text-white">Create asset manually</h3>
          <div className="grid grid-cols-3 gap-3">
            <div><label className="label">Asset tag</label>
              <input className="field font-mono" value={form.assetTag} onChange={(e) => setForm({ ...form, assetTag: e.target.value.toUpperCase() })} placeholder="FF-001234" /></div>
            <div><label className="label">Serial number</label>
              <input className="field font-mono" value={form.serialNo} onChange={(e) => setForm({ ...form, serialNo: e.target.value })} /></div>
            <div><label className="label">Condition</label>
              <select className="field" value={form.condition} onChange={(e) => setForm({ ...form, condition: e.target.value })}>
                <option>NEW</option><option>GOOD</option><option>FAIR</option><option>POOR</option>
              </select></div>
            <div><label className="label">SKU</label>
              <select className="field" value={form.skuId} onChange={(e) => setForm({ ...form, skuId: e.target.value })}>
                <option value="">Pick…</option>
                {skus.data?.map((s: any) => <option key={s.id} value={s.id}>{s.code} – {s.name}</option>)}
              </select></div>
            <div><label className="label">Supplier (optional)</label>
              <select className="field" value={form.supplierId} onChange={(e) => setForm({ ...form, supplierId: e.target.value })}>
                <option value="">—</option>
                {suppliers.data?.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select></div>
            <div><label className="label">Location</label>
              <select className="field" value={form.locationId} onChange={(e) => setForm({ ...form, locationId: e.target.value })}>
                <option value="">—</option>
                {locations.data?.map((l: any) => <option key={l.id} value={l.id}>{l.code} – {l.name}</option>)}
              </select></div>
            <div><label className="label">Purchase date</label>
              <input type="date" className="field" value={form.purchaseDate} onChange={(e) => setForm({ ...form, purchaseDate: e.target.value })} /></div>
            <div><label className="label">Purchase cost (cents)</label>
              <input type="number" className="field" value={form.purchaseCostCents} onChange={(e) => setForm({ ...form, purchaseCostCents: +e.target.value })} /></div>
            <div><label className="label">Warranty expiry</label>
              <input type="date" className="field" value={form.warrantyExpiry} onChange={(e) => setForm({ ...form, warrantyExpiry: e.target.value })} /></div>
          </div>
          <div className="mt-4 flex gap-2">
            <button className="btn-primary" disabled={!form.assetTag || !form.skuId || create.isPending}
                    onClick={() => create.mutate()}>
              {create.isPending ? 'Creating…' : 'Create asset'}
            </button>
            <p className="self-center text-xs text-ink-200">
              Cost is in <b>cents</b> — R 12,500.00 = <code className="text-brand-300">1250000</code>.
            </p>
          </div>
        </div>
      )}

      <div className="mb-4 flex gap-2">
        <input className="field max-w-sm" placeholder="Search by tag, serial, model…"
               value={q} onChange={(e) => setQ(e.target.value)} />
      </div>
      <div className="card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr>
              <th className="th">Tag</th><th className="th">SKU</th><th className="th">Serial</th>
              <th className="th">Location</th><th className="th">Status</th>
              <th className="th text-right">Value</th>
            </tr>
          </thead>
          <tbody>
            {assets.data?.map((a: any) => (
              <tr key={a.id} className="border-t border-ink-500/30">
                <td className="td font-mono">
                  <Link to={`/assets/${a.id}`} className="text-brand-300 hover:underline">{a.assetTag}</Link>
                </td>
                <td className="td">{a.sku?.manufacturer} {a.sku?.model}</td>
                <td className="td font-mono text-xs">{a.serialNo ?? '—'}</td>
                <td className="td">{a.location?.name ?? '—'}</td>
                <td className="td"><Pill status={a.status} /></td>
                <td className="td text-right font-mono">{formatZAR(a.currentValueCents)}</td>
              </tr>
            ))}
            {assets.data?.length === 0 && (
              <tr><td className="td" colSpan={6}>No assets yet — create one above, or confirm a GRV.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
