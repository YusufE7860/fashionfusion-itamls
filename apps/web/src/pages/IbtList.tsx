import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { PageHeader } from '@/components/PageHeader';
import { Pill } from '@/components/Pill';
import { SignaturePad } from '@/components/SignaturePad';
import { useAuth } from '@/store/auth';
import { Truck, FileDown, Check, Plus, X } from 'lucide-react';

export function IbtList() {
  const qc = useQueryClient();
  const token = useAuth((s) => s.token);
  const hasPerm = useAuth((s) => s.hasPermission);
  const ibts = useQuery({ queryKey: ['ibt'], queryFn: () => api.get('/ibt').then((r) => r.data) });

  // Create form
  const [showNew, setShowNew] = useState(false);
  const locations = useQuery({ queryKey: ['locations'], queryFn: () => api.get('/locations').then((r) => r.data), enabled: showNew });
  const skus      = useQuery({ queryKey: ['skus'],      queryFn: () => api.get('/skus').then((r) => r.data),      enabled: showNew });
  const assets    = useQuery({ queryKey: ['assets'],    queryFn: () => api.get('/assets').then((r) => r.data),    enabled: showNew });
  const [head, setHead] = useState({ fromLocationId: '', toLocationId: '', notes: '' });
  const [lines, setLines] = useState<{ skuId: string; assetId: string; qty: number }[]>([
    { skuId: '', assetId: '', qty: 1 },
  ]);
  const create = useMutation({
    mutationFn: () => api.post('/ibt', {
      ...head,
      lines: lines.map((l) => ({ skuId: l.skuId, assetId: l.assetId || undefined, qty: l.qty })),
    }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ibt'] });
      setShowNew(false);
      setHead({ fromLocationId: '', toLocationId: '', notes: '' });
      setLines([{ skuId: '', assetId: '', qty: 1 }]);
    },
    onError: (e: any) => alert(e.response?.data?.message ?? 'Create failed'),
  });

  // Dispatch + receive
  const [dispatchFor, setDispatchFor] = useState<string | null>(null);
  const [courier, setCourier] = useState('');
  const [trackingNo, setTrackingNo] = useState('');
  const [boxNumbers, setBoxNumbers] = useState('');
  const [receiveFor, setReceiveFor] = useState<string | null>(null);
  const [signedBy, setSignedBy] = useState('');
  const [signature, setSignature] = useState<string | null>(null);

  const approve = useMutation({
    mutationFn: (id: string) => api.post(`/ibt/${id}/approve`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ibt'] }),
  });
  const dispatch = useMutation({
    mutationFn: ({ id, body }: { id: string; body: any }) =>
      api.post(`/ibt/${id}/dispatch`, body).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ibt'] });
      setDispatchFor(null); setCourier(''); setTrackingNo(''); setBoxNumbers('');
    },
  });
  const receive = useMutation({
    mutationFn: ({ id, body }: { id: string; body: any }) =>
      api.post(`/ibt/${id}/receive`, body).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['ibt'] });
      setReceiveFor(null); setSignedBy(''); setSignature(null);
    },
  });

  function openNote(id: string) {
    fetch(`${api.defaults.baseURL}/ibt/${id}/dispatch-note.pdf`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.blob()).then((b) => window.open(URL.createObjectURL(b), '_blank'));
  }

  return (
    <>
      <PageHeader
        title="Internal Branch Transfers"
        subtitle="Move stock and assets between locations"
        actions={hasPerm('ibt:create') &&
          <button className="btn-primary" onClick={() => setShowNew(!showNew)}>
            {showNew ? <><X size={14}/>Cancel</> : <><Plus size={14}/>New transfer</>}
          </button>}
      />

      {showNew && (
        <div className="card mb-4 p-4">
          <h3 className="mb-3 text-sm font-semibold text-white">New transfer</h3>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">From</label>
              <select className="field" value={head.fromLocationId} onChange={(e) => setHead({ ...head, fromLocationId: e.target.value })}>
                <option value="">Pick…</option>
                {locations.data?.map((l: any) => <option key={l.id} value={l.id}>{l.code} – {l.name}</option>)}
              </select></div>
            <div><label className="label">To</label>
              <select className="field" value={head.toLocationId} onChange={(e) => setHead({ ...head, toLocationId: e.target.value })}>
                <option value="">Pick…</option>
                {locations.data?.map((l: any) => <option key={l.id} value={l.id}>{l.code} – {l.name}</option>)}
              </select></div>
            <div className="col-span-2"><label className="label">Notes</label>
              <input className="field" value={head.notes} onChange={(e) => setHead({ ...head, notes: e.target.value })} placeholder="Optional context for the receiver" /></div>
          </div>

          <h4 className="mb-2 mt-4 text-[11px] font-bold uppercase tracking-wider text-ink-200">Lines</h4>
          <table className="w-full">
            <thead><tr>
              <th className="th">SKU</th><th className="th">Specific asset (optional)</th>
              <th className="th">Qty</th><th></th>
            </tr></thead>
            <tbody>
              {lines.map((l, i) => (
                <tr key={i} className="border-t border-ink-500/30">
                  <td className="td">
                    <select className="field" value={l.skuId} onChange={(e) => {
                      const c = [...lines]; c[i].skuId = e.target.value; c[i].assetId = ''; setLines(c);
                    }}>
                      <option value="">Pick…</option>
                      {skus.data?.map((s: any) => <option key={s.id} value={s.id}>{s.code} – {s.name}</option>)}
                    </select>
                  </td>
                  <td className="td">
                    <select className="field" value={l.assetId} onChange={(e) => {
                      const c = [...lines]; c[i].assetId = e.target.value; setLines(c);
                    }}>
                      <option value="">—</option>
                      {assets.data?.filter((a: any) => !l.skuId || a.sku.id === l.skuId).slice(0, 50).map((a: any) =>
                        <option key={a.id} value={a.id}>{a.assetTag} ({a.status})</option>)}
                    </select>
                  </td>
                  <td className="td"><input type="number" min={1} className="field w-20" value={l.qty}
                    onChange={(e) => { const c = [...lines]; c[i].qty = +e.target.value; setLines(c); }} /></td>
                  <td className="td"><button className="btn-ghost" onClick={() => setLines(lines.filter((_, j) => j !== i))}><X size={12}/></button></td>
                </tr>
              ))}
            </tbody>
          </table>
          <div className="mt-2 flex gap-2">
            <button className="btn-ghost" onClick={() => setLines([...lines, { skuId: '', assetId: '', qty: 1 }])}>+ Line</button>
            <button className="btn-primary"
              disabled={!head.fromLocationId || !head.toLocationId || !lines.every((l) => l.skuId && l.qty > 0) || create.isPending}
              onClick={() => create.mutate()}>
              {create.isPending ? 'Saving…' : 'Submit transfer request'}
            </button>
          </div>
        </div>
      )}

      {dispatchFor && (
        <div className="card mb-4 p-5">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white"><Truck size={16}/>Dispatch transfer</h3>
          <div className="grid grid-cols-3 gap-3">
            <div><label className="label">Courier</label>
              <input className="field" value={courier} onChange={(e) => setCourier(e.target.value)} placeholder="e.g. Aramex" /></div>
            <div><label className="label">Tracking number</label>
              <input className="field" value={trackingNo} onChange={(e) => setTrackingNo(e.target.value)} placeholder="e.g. 12345678ZA" /></div>
            <div><label className="label">Box number(s) <span className="text-ink-200/70">— optional</span></label>
              <input className="field" value={boxNumbers} onChange={(e) => setBoxNumbers(e.target.value)} placeholder="e.g. BOX-001, BOX-002" /></div>
          </div>
          <div className="mt-3 flex gap-2">
            <button className="btn-primary"
              onClick={() => dispatch.mutate({ id: dispatchFor, body: { courier, trackingNo, boxNumbers } })}>
              Confirm dispatch
            </button>
            <button className="btn-ghost" onClick={() => setDispatchFor(null)}>Cancel</button>
          </div>
        </div>
      )}

      {receiveFor && (
        <div className="card mb-4 p-5">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-white"><Check size={16}/>Receive transfer</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="label">Print name (received by)</label>
              <input className="field" value={signedBy} onChange={(e) => setSignedBy(e.target.value)} placeholder="e.g. Lerato Khumalo" />
              <p className="mt-3 text-[11px] text-ink-200">
                Signing acknowledges receipt of all items listed on the dispatch note in good condition.
              </p>
            </div>
            <div>
              <label className="label">Signature</label>
              <SignaturePad onChange={setSignature} />
            </div>
          </div>
          <div className="mt-4 flex gap-2">
            <button className="btn-primary"
              disabled={!signedBy || !signature || receive.isPending}
              onClick={() => receive.mutate({ id: receiveFor, body: { signedBy, signatureDataUrl: signature } })}>
              {receive.isPending ? 'Confirming…' : 'Confirm receipt'}
            </button>
            <button className="btn-ghost" onClick={() => setReceiveFor(null)}>Cancel</button>
          </div>
        </div>
      )}

      <div className="card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr>
              <th className="th">Code</th><th className="th">From</th><th className="th">To</th>
              <th className="th">Status</th><th className="th">Courier</th>
              <th className="th">Tracking</th><th className="th">Boxes</th>
              <th className="th">Actions</th>
            </tr>
          </thead>
          <tbody>
            {ibts.data?.map((i: any) => (
              <tr key={i.id} className="border-t border-ink-500/30">
                <td className="td font-mono">{i.code}</td>
                <td className="td">{i.fromLoc?.name}</td>
                <td className="td">{i.toLoc?.name}</td>
                <td className="td"><Pill status={i.status} /></td>
                <td className="td">{i.courier ?? '—'}</td>
                <td className="td font-mono text-xs">{i.trackingNo ?? '—'}</td>
                <td className="td font-mono text-xs">{i.boxNumbers ?? '—'}</td>
                <td className="td">
                  <div className="flex flex-wrap gap-1 text-xs">
                    {(i.status === 'DISPATCHED' || i.status === 'RECEIVED') &&
                      <button className="btn-ghost" onClick={() => openNote(i.id)}><FileDown size={12}/>Note</button>}
                    {i.status === 'REQUESTED' && hasPerm('ibt:approve') &&
                      <button className="btn-ghost" onClick={() => approve.mutate(i.id)}>Approve</button>}
                    {i.status === 'APPROVED' && hasPerm('ibt:dispatch') &&
                      <button className="btn-ghost" onClick={() => setDispatchFor(i.id)}>Dispatch</button>}
                    {(i.status === 'DISPATCHED' || i.status === 'IN_TRANSIT') && hasPerm('ibt:receive') &&
                      <button className="btn-ghost" onClick={() => setReceiveFor(i.id)}>Receive</button>}
                  </div>
                </td>
              </tr>
            ))}
            {(!ibts.data || ibts.data.length === 0) && (
              <tr><td className="td" colSpan={8}>No transfers yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
