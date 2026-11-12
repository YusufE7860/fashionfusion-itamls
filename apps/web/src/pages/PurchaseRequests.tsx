import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { PageHeader } from '@/components/PageHeader';
import { Pill } from '@/components/Pill';
import { useAuth } from '@/store/auth';
import { formatZAR } from '@itamls/shared';
import { X } from 'lucide-react';
import { RandInput } from '@/components/RandInput';

export function PurchaseRequests() {
  const qc = useQueryClient();
  const hasPerm = useAuth((s) => s.hasPermission);
  const prs = useQuery({ queryKey: ['prs'], queryFn: () => api.get('/purchase-requests').then((r) => r.data) });
  const skus = useQuery({ queryKey: ['skus'], queryFn: () => api.get('/skus').then((r) => r.data) });
  const suppliers = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => api.get<any[]>('/suppliers').then((r) => r.data).catch(() => []),
  });

  // Approve + issue PO modal
  const [approving, setApproving] = useState<any | null>(null);
  const [supplierId, setSupplierId] = useState('');
  const [expectedDelivery, setExpectedDelivery] = useState('');

  const approveAndIssuePo = useMutation({
    mutationFn: async ({ prId, supplierId, expectedDelivery }: { prId: string; supplierId: string; expectedDelivery?: string }) => {
      // Two steps server-side: transition PR → IT_APPROVED, then create PO
      // (which also transitions the PR to ORDERED). We do them in order so a
      // failed PO creation leaves the PR at IT_APPROVED for retry.
      await api.post(`/purchase-requests/${prId}/approve-it`);
      return api.post('/purchase-orders', { prId, supplierId, expectedDelivery }).then((r) => r.data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['prs'] });
      qc.invalidateQueries({ queryKey: ['pos'] });
      setApproving(null);
      setSupplierId('');
      setExpectedDelivery('');
    },
    onError: (e: any) => alert(e?.response?.data?.message ?? 'Could not issue PO'),
  });

  const [showNew, setShowNew] = useState(false);
  const [justification, setJustification] = useState('');
  const [lines, setLines] = useState<{ skuId: string; qty: number; estUnitCostCents: number }[]>([
    { skuId: '', qty: 1, estUnitCostCents: 0 },
  ]);

  const create = useMutation({
    mutationFn: (body: any) => api.post('/purchase-requests', body).then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['prs'] }); setShowNew(false); setLines([{ skuId: '', qty: 1, estUnitCostCents: 0 }]); },
  });

  const transition = useMutation({
    mutationFn: ({ id, path }: { id: string; path: string }) =>
      api.post(`/purchase-requests/${id}/${path}`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['prs'] }),
  });

  return (
    <>
      <PageHeader
        title="Purchase Requests"
        subtitle="Technician → IT Manager → Finance approval flow"
        actions={hasPerm('procurement:create') &&
          <button className="btn-primary" onClick={() => setShowNew(!showNew)}>{showNew ? 'Cancel' : 'New PR'}</button>}
      />

      {showNew && (
        <div className="card mb-4 p-4">
          <h3 className="mb-2 text-sm font-semibold">New purchase request</h3>
          <textarea className="field mb-2" placeholder="Justification…" value={justification} onChange={(e) => setJustification(e.target.value)} />
          <table className="w-full text-sm">
            <thead><tr><th className="th">SKU</th><th className="th">Qty</th><th className="th">Est unit price</th><th></th></tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i} className="border-t">
                  <td className="td">
                    <select className="field" value={l.skuId} onChange={(e) => {
                      const copy = [...lines]; copy[i].skuId = e.target.value; setLines(copy);
                    }}>
                      <option value="">Pick a SKU…</option>
                      {skus.data?.map((s: any) => <option key={s.id} value={s.id}>{s.code} – {s.name}</option>)}
                    </select>
                  </td>
                  <td className="td">
                    <input type="text" inputMode="numeric" className="field w-20" value={l.qty}
                      onChange={(e) => {
                        const c = [...lines];
                        const n = parseInt(e.target.value.replace(/[^\d]/g, ''), 10);
                        c[i].qty = Number.isFinite(n) ? n : 0;
                        setLines(c);
                      }} />
                  </td>
                  <td className="td">
                    <RandInput valueCents={l.estUnitCostCents}
                      onChangeCents={(v) => { const c = [...lines]; c[i].estUnitCostCents = v ?? 0; setLines(c); }} />
                  </td>
                  <td className="td"><button className="btn-ghost" onClick={() => setLines(lines.filter((_, j) => j !== i))}>×</button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-2 flex gap-2">
            <button className="btn-ghost" onClick={() => setLines([...lines, { skuId: '', qty: 1, estUnitCostCents: 0 }])}>+ Line</button>
            <button className="btn-primary"
              disabled={!lines.every((l) => l.skuId && l.qty > 0) || create.isPending}
              onClick={() => create.mutate({ justification, lines })}>Save draft</button>
          </div>
        </div>
      )}

      {approving && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4"
          onClick={() => setApproving(null)}>
          <div className="w-full max-w-md rounded-xl bg-white p-5 shadow-2xl"
            onClick={(e) => e.stopPropagation()}>
            <div className="mb-3 flex items-start justify-between">
              <div>
                <h3 className="text-base font-semibold">Approve &amp; issue PO</h3>
                <p className="text-xs text-ink-300">
                  {approving.code} — {approving.lines?.length ?? 0} line item(s), est.&nbsp;
                  <b>{formatZAR(approving.totalEstCents)}</b>
                </p>
              </div>
              <button className="btn-ghost" onClick={() => setApproving(null)}><X size={14}/></button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="label">Supplier</label>
                <select className="field" value={supplierId}
                  onChange={(e) => setSupplierId(e.target.value)}>
                  <option value="">Pick a supplier…</option>
                  {suppliers.data?.map((s: any) => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
                {suppliers.data?.length === 0 && (
                  <p className="mt-1 text-[11px] text-rose-600">
                    No suppliers configured yet. Add one under Admin → Suppliers first.
                  </p>
                )}
              </div>
              <div>
                <label className="label">Expected delivery <span className="text-ink-400">(optional)</span></label>
                <input type="date" className="field" value={expectedDelivery}
                  onChange={(e) => setExpectedDelivery(e.target.value)}/>
              </div>
              <div className="flex justify-end gap-2 border-t border-ink-500/10 pt-3">
                <button className="btn-ghost" onClick={() => setApproving(null)}>Cancel</button>
                <button className="btn-primary"
                  disabled={!supplierId || approveAndIssuePo.isPending}
                  onClick={() => approveAndIssuePo.mutate({
                    prId: approving.id,
                    supplierId,
                    expectedDelivery: expectedDelivery || undefined,
                  })}>
                  {approveAndIssuePo.isPending ? 'Issuing…' : 'Approve &amp; Issue PO'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <div className="card overflow-hidden">
        <table className="w-full">
          <thead className="bg-slate-50">
            <tr>
              <th className="th">Code</th><th className="th">Requester</th>
              <th className="th">Status</th><th className="th text-right">Est total</th>
              <th className="th">Actions</th>
            </tr>
          </thead>
          <tbody>
            {prs.data?.map((p: any) => (
              <tr key={p.id} className="border-t">
                <td className="td font-mono">{p.code}</td>
                <td className="td">{p.requester?.fullName}</td>
                <td className="td"><Pill status={p.status} /></td>
                <td className="td text-right">{formatZAR(p.totalEstCents)}</td>
                <td className="td">
                  <div className="flex gap-1 text-xs">
                    {p.status === 'DRAFT' && hasPerm('procurement:create') &&
                      <button className="btn-ghost" onClick={() => transition.mutate({ id: p.id, path: 'submit' })}>Submit</button>}
                    {p.status === 'SUBMITTED' && hasPerm('procurement:approve:it') &&
                      <button className="btn-primary"
                        onClick={() => { setApproving(p); setSupplierId(''); setExpectedDelivery(''); }}>
                        Approve &amp; Issue PO
                      </button>}
                  </div>
                </td>
              </tr>
            ))}
            {(!prs.data || prs.data.length === 0) && (
              <tr><td className="td" colSpan={5}>No purchase requests yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
