import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { PageHeader } from '@/components/PageHeader';
import { Pill } from '@/components/Pill';
import { useAuth } from '@/store/auth';
import { formatZAR } from '@itamls/shared';
import { Plus, X } from 'lucide-react';

export function Repairs() {
  const qc = useQueryClient();
  const hasPerm = useAuth((s) => s.hasPermission);
  const repairs = useQuery({ queryKey: ['repairs'], queryFn: () => api.get('/repairs').then((r) => r.data) });

  const [showNew, setShowNew] = useState(false);
  const assets    = useQuery({ queryKey: ['assets'],    queryFn: () => api.get('/assets').then((r) => r.data),    enabled: showNew });
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: () => api.get('/suppliers').then((r) => r.data), enabled: showNew });
  const [form, setForm] = useState({ assetId: '', faultDesc: '', supplierId: '', warrantyClaim: false });
  const [assetQ, setAssetQ] = useState('');

  const create = useMutation({
    mutationFn: () => api.post('/repairs', {
      ...form, supplierId: form.supplierId || undefined,
    }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['repairs'] });
      setShowNew(false);
      setForm({ assetId: '', faultDesc: '', supplierId: '', warrantyClaim: false });
    },
    onError: (e: any) => alert(e.response?.data?.message ?? 'Create failed'),
  });

  const transition = useMutation({
    mutationFn: ({ id, target, costCents }: any) =>
      api.post(`/repairs/${id}/transition`, { target, costCents }).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['repairs'] }),
  });

  const filteredAssets = (assets.data ?? []).filter((a: any) =>
    !assetQ || a.assetTag.toLowerCase().includes(assetQ.toLowerCase())
            || a.sku?.model.toLowerCase().includes(assetQ.toLowerCase())
            || a.serialNo?.toLowerCase().includes(assetQ.toLowerCase()),
  ).slice(0, 80);

  return (
    <>
      <PageHeader
        title="Repairs"
        subtitle="Fault logging, RMA tracking and warranty claims"
        actions={hasPerm('repairs:write') &&
          <button className="btn-primary" onClick={() => setShowNew(!showNew)}>
            {showNew ? <><X size={14}/>Cancel</> : <><Plus size={14}/>New repair</>}
          </button>}
      />

      {showNew && (
        <div className="card mb-4 p-4">
          <h3 className="mb-3 text-sm font-semibold text-white">Log a fault</h3>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="label">Search asset</label>
              <input className="field font-mono" value={assetQ} onChange={(e) => setAssetQ(e.target.value)} placeholder="tag, serial or model" />
              <label className="label mt-2">Pick asset</label>
              <select className="field" value={form.assetId} onChange={(e) => setForm({ ...form, assetId: e.target.value })}>
                <option value="">—</option>
                {filteredAssets.map((a: any) =>
                  <option key={a.id} value={a.id}>{a.assetTag} – {a.sku?.model} ({a.status})</option>)}
              </select>
              <label className="label mt-2">Supplier (optional)</label>
              <select className="field" value={form.supplierId} onChange={(e) => setForm({ ...form, supplierId: e.target.value })}>
                <option value="">—</option>
                {suppliers.data?.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
              <label className="mt-3 flex items-center gap-2 text-sm text-ink-100">
                <input type="checkbox" checked={form.warrantyClaim} onChange={(e) => setForm({ ...form, warrantyClaim: e.target.checked })} />
                This is a warranty claim
              </label>
            </div>
            <div>
              <label className="label">Fault description</label>
              <textarea className="field h-40" value={form.faultDesc}
                        onChange={(e) => setForm({ ...form, faultDesc: e.target.value })}
                        placeholder="Describe the fault…" />
            </div>
          </div>
          <button className="btn-primary mt-3"
            disabled={!form.assetId || !form.faultDesc.trim() || create.isPending}
            onClick={() => create.mutate()}>
            {create.isPending ? 'Logging…' : 'Log fault'}
          </button>
        </div>
      )}

      <div className="card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr>
              <th className="th">Code</th><th className="th">Asset</th><th className="th">Fault</th>
              <th className="th">Status</th><th className="th">Warranty</th>
              <th className="th text-right">Cost</th><th className="th">Actions</th>
            </tr>
          </thead>
          <tbody>
            {repairs.data?.map((r: any) => (
              <tr key={r.id} className="border-t border-ink-500/30">
                <td className="td font-mono">{r.code}</td>
                <td className="td">{r.asset?.assetTag} <span className="text-xs text-ink-200">{r.asset?.sku?.model}</span></td>
                <td className="td max-w-xs truncate">{r.faultDesc}</td>
                <td className="td"><Pill status={r.status} /></td>
                <td className="td">{r.warrantyClaim ? 'Yes' : '—'}</td>
                <td className="td text-right font-mono">{formatZAR(r.costCents)}</td>
                <td className="td">
                  <div className="flex gap-1 text-xs">
                    {r.status === 'LOGGED' && <button className="btn-ghost" onClick={() => transition.mutate({ id: r.id, target: 'SENT' })}>Send</button>}
                    {r.status === 'SENT' && <button className="btn-ghost" onClick={() => transition.mutate({ id: r.id, target: 'AT_SUPPLIER' })}>At supplier</button>}
                    {r.status === 'AT_SUPPLIER' && (
                      <>
                        <button className="btn-ghost" onClick={() => {
                          const c = prompt('Repair cost (cents):');
                          if (c !== null) transition.mutate({ id: r.id, target: 'RETURNED', costCents: Number(c) });
                        }}>Returned</button>
                        <button className="btn-ghost" onClick={() => transition.mutate({ id: r.id, target: 'WRITTEN_OFF' })}>Write off</button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {(!repairs.data || repairs.data.length === 0) && (
              <tr><td className="td" colSpan={7}>No repairs logged yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
