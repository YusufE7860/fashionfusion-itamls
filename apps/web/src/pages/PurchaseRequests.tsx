import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { PageHeader } from '@/components/PageHeader';
import { Pill } from '@/components/Pill';
import { useAuth } from '@/store/auth';
import { formatZAR } from '@itamls/shared';

export function PurchaseRequests() {
  const qc = useQueryClient();
  const hasPerm = useAuth((s) => s.hasPermission);
  const prs = useQuery({ queryKey: ['prs'], queryFn: () => api.get('/purchase-requests').then((r) => r.data) });
  const skus = useQuery({ queryKey: ['skus'], queryFn: () => api.get('/skus').then((r) => r.data) });

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
            <thead><tr><th className="th">SKU</th><th className="th">Qty</th><th className="th">Est unit (cents)</th><th></th></tr></thead>
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
                  <td className="td"><input type="number" className="field w-20" value={l.qty}
                    onChange={(e) => { const c = [...lines]; c[i].qty = +e.target.value; setLines(c); }} /></td>
                  <td className="td"><input type="number" className="field w-32" value={l.estUnitCostCents}
                    onChange={(e) => { const c = [...lines]; c[i].estUnitCostCents = +e.target.value; setLines(c); }} /></td>
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
                      <button className="btn-ghost" onClick={() => transition.mutate({ id: p.id, path: 'approve-it' })}>IT approve</button>}
                    {p.status === 'IT_APPROVED' && hasPerm('procurement:approve:finance') &&
                      <button className="btn-ghost" onClick={() => transition.mutate({ id: p.id, path: 'approve-finance' })}>Finance approve</button>}
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
