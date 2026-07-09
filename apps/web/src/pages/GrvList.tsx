import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { PageHeader } from '@/components/PageHeader';
import { Pill } from '@/components/Pill';
import { useAuth } from '@/store/auth';
import { formatZAR } from '@itamls/shared';
import { Plus, X, Check } from 'lucide-react';

export function GrvList() {
  const qc = useQueryClient();
  const hasPerm = useAuth((s) => s.hasPermission);
  const grvs = useQuery({ queryKey: ['grv'], queryFn: () => api.get('/grv').then((r) => r.data) });

  const [showNew, setShowNew] = useState(false);
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: () => api.get('/suppliers').then((r) => r.data), enabled: showNew });
  const skus      = useQuery({ queryKey: ['skus'],      queryFn: () => api.get('/skus').then((r) => r.data),      enabled: showNew });
  const locations = useQuery({ queryKey: ['locations'], queryFn: () => api.get('/locations').then((r) => r.data), enabled: showNew });

  const [head, setHead] = useState({ supplierId: '', invoiceNo: '', invoiceDate: new Date().toISOString().slice(0,10), deliveryNoteNo: '' });
  const [lines, setLines] = useState<{ skuId: string; qty: number; unitCostCents: number; serialNumbers: string; warrantyExpiry: string }[]>([
    { skuId: '', qty: 1, unitCostCents: 0, serialNumbers: '', warrantyExpiry: '' },
  ]);

  const create = useMutation({
    mutationFn: () => api.post('/grv', {
      ...head,
      receivingLocationId: '',  // confirm step asks for it
      lines: lines.map((l) => ({
        skuId: l.skuId, qty: l.qty, unitCostCents: l.unitCostCents,
        serialNumbers: l.serialNumbers || undefined,
        warrantyExpiry: l.warrantyExpiry || undefined,
      })),
    }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['grv'] });
      setShowNew(false);
      setHead({ supplierId: '', invoiceNo: '', invoiceDate: new Date().toISOString().slice(0,10), deliveryNoteNo: '' });
      setLines([{ skuId: '', qty: 1, unitCostCents: 0, serialNumbers: '', warrantyExpiry: '' }]);
    },
    onError: (e: any) => alert(e.response?.data?.message ?? 'Create failed'),
  });

  const [confirmFor, setConfirmFor] = useState<string | null>(null);
  const [receiveLoc, setReceiveLoc] = useState('');
  const confirmGrv = useMutation({
    mutationFn: () => api.post(`/grv/${confirmFor}/confirm`, { receivingLocationId: receiveLoc }).then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['grv'] }); setConfirmFor(null); setReceiveLoc(''); },
    onError: (e: any) => alert(e.response?.data?.message ?? 'Confirm failed'),
  });

  return (
    <>
      <PageHeader
        title="Goods Received Vouchers"
        subtitle="Capture incoming stock against supplier invoices"
        actions={hasPerm('grv:create') &&
          <button className="btn-primary" onClick={() => setShowNew(!showNew)}>
            {showNew ? <><X size={14}/>Cancel</> : <><Plus size={14}/>New GRV</>}
          </button>}
      />

      {showNew && (
        <div className="card mb-4 p-4">
          <h3 className="mb-3 text-sm font-semibold text-white">New GRV</h3>
          <div className="grid grid-cols-4 gap-3">
            <div><label className="label">Supplier</label>
              <select className="field" value={head.supplierId} onChange={(e) => setHead({ ...head, supplierId: e.target.value })}>
                <option value="">Pick…</option>
                {suppliers.data?.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select></div>
            <div><label className="label">Invoice no.</label>
              <input className="field" value={head.invoiceNo} onChange={(e) => setHead({ ...head, invoiceNo: e.target.value })} /></div>
            <div><label className="label">Invoice date</label>
              <input type="date" className="field" value={head.invoiceDate} onChange={(e) => setHead({ ...head, invoiceDate: e.target.value })} /></div>
            <div><label className="label">Delivery note</label>
              <input className="field" value={head.deliveryNoteNo} onChange={(e) => setHead({ ...head, deliveryNoteNo: e.target.value })} /></div>
          </div>

          <h4 className="mb-2 mt-4 text-[11px] font-bold uppercase tracking-wider text-ink-200">Lines</h4>
          <table className="w-full">
            <thead><tr>
              <th className="th">SKU</th><th className="th">Qty</th><th className="th">Unit cost (cents)</th>
              <th className="th">Serial numbers (CSV)</th><th className="th">Warranty expiry</th><th></th>
            </tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i} className="border-t border-ink-500/30">
                  <td className="td">
                    <select className="field" value={l.skuId} onChange={(e) => {
                      const c = [...lines]; c[i].skuId = e.target.value; setLines(c);
                    }}>
                      <option value="">Pick…</option>
                      {skus.data?.map((s: any) => <option key={s.id} value={s.id}>{s.code} – {s.name}{s.isSerialised ? ' ⓢ' : ''}</option>)}
                    </select>
                  </td>
                  <td className="td"><input type="number" min={1} className="field w-20" value={l.qty}
                    onChange={(e) => { const c = [...lines]; c[i].qty = +e.target.value; setLines(c); }} /></td>
                  <td className="td"><input type="number" min={0} className="field w-32" value={l.unitCostCents}
                    onChange={(e) => { const c = [...lines]; c[i].unitCostCents = +e.target.value; setLines(c); }} /></td>
                  <td className="td"><input className="field font-mono text-xs" value={l.serialNumbers}
                    placeholder="SN-001, SN-002"
                    onChange={(e) => { const c = [...lines]; c[i].serialNumbers = e.target.value; setLines(c); }} /></td>
                  <td className="td"><input type="date" className="field" value={l.warrantyExpiry}
                    onChange={(e) => { const c = [...lines]; c[i].warrantyExpiry = e.target.value; setLines(c); }} /></td>
                  <td className="td">
                    <button className="btn-ghost" onClick={() => setLines(lines.filter((_, j) => j !== i))}><X size={12}/></button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-2 flex gap-2">
            <button className="btn-ghost" onClick={() => setLines([...lines, { skuId: '', qty: 1, unitCostCents: 0, serialNumbers: '', warrantyExpiry: '' }])}>+ Line</button>
            <button className="btn-primary"
              disabled={!head.supplierId || !lines.every((l) => l.skuId && l.qty > 0) || create.isPending}
              onClick={() => create.mutate()}>
              {create.isPending ? 'Saving…' : 'Save GRV as draft'}
            </button>
          </div>
          <p className="mt-2 text-[11px] text-ink-200">
            <b>ⓢ</b> = serialised SKU. Provide one serial per unit (comma-separated) when confirming the GRV.
          </p>
        </div>
      )}

      {confirmFor && (
        <div className="card mb-4 p-4">
          <h3 className="mb-3 text-sm font-semibold text-white">Confirm GRV — pick receiving location</h3>
          <div className="flex items-end gap-3">
            <div className="flex-1">
              <label className="label">Receiving location</label>
              <select className="field" value={receiveLoc} onChange={(e) => setReceiveLoc(e.target.value)}>
                <option value="">Pick…</option>
                {locations.data?.map((l: any) => <option key={l.id} value={l.id}>{l.code} – {l.name}</option>)}
              </select>
            </div>
            <button className="btn-primary" disabled={!receiveLoc || confirmGrv.isPending}
              onClick={() => confirmGrv.mutate()}>
              <Check size={14}/>{confirmGrv.isPending ? 'Confirming…' : 'Confirm receipt'}
            </button>
            <button className="btn-ghost" onClick={() => setConfirmFor(null)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr>
              <th className="th">Code</th><th className="th">Supplier</th><th className="th">Invoice no.</th>
              <th className="th">Status</th><th className="th text-right">Total</th>
              <th className="th">Received</th><th className="th">Actions</th>
            </tr>
          </thead>
          <tbody>
            {grvs.data?.map((g: any) => (
              <tr key={g.id} className="border-t border-ink-500/30">
                <td className="td font-mono">{g.code}</td>
                <td className="td">{g.supplier?.name}</td>
                <td className="td">{g.invoiceNo ?? '—'}</td>
                <td className="td"><Pill status={g.status} /></td>
                <td className="td text-right font-mono">{formatZAR(g.totalCents)}</td>
                <td className="td">{new Date(g.receivedAt).toLocaleDateString()}</td>
                <td className="td">
                  {g.status === 'DRAFT' && hasPerm('grv:confirm') &&
                    <button className="btn-ghost" onClick={() => { setConfirmFor(g.id); locations.refetch?.(); }}>
                      <Check size={12}/>Confirm
                    </button>}
                </td>
              </tr>
            ))}
            {(!grvs.data || grvs.data.length === 0) && (
              <tr><td className="td" colSpan={7}>No GRVs yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
