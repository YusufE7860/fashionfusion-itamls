import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { PageHeader } from '@/components/PageHeader';
import { Pill } from '@/components/Pill';
import { formatZAR } from '@itamls/shared';
import { useAuth } from '@/store/auth';
import { Wrench, Printer, QrCode, Trash2 } from 'lucide-react';

export function AssetDetail() {
  const { id } = useParams();
  const qc = useQueryClient();
  const token = useAuth((s) => s.token);
  const hasPerm = useAuth((s) => s.hasPermission);
  const [showFault, setShowFault] = useState(false);
  const [fault, setFault] = useState('');
  const [warrantyClaim, setWarrantyClaim] = useState(true);
  const [showDispose, setShowDispose] = useState(false);
  const [dispose, setDispose] = useState({ reason: 'OBSOLETE', notes: '', disposalVendor: '' });
  const [wipeFile, setWipeFile] = useState<File | null>(null);
  const [slipFile, setSlipFile] = useState<File | null>(null);

  const asset = useQuery({
    queryKey: ['asset', id],
    queryFn: () => api.get(`/assets/${id}`).then((r) => r.data),
    enabled: !!id,
  });

  const logFault = useMutation({
    mutationFn: () => api.post('/repairs', { assetId: id, faultDesc: fault, warrantyClaim }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['asset', id] });
      qc.invalidateQueries({ queryKey: ['repairs'] });
      setShowFault(false); setFault('');
    },
  });

  const doDispose = useMutation({
    mutationFn: () => {
      const fd = new FormData();
      fd.append('reason', dispose.reason);
      if (dispose.notes) fd.append('notes', dispose.notes);
      if (dispose.disposalVendor) fd.append('disposalVendor', dispose.disposalVendor);
      if (wipeFile) fd.append('dataWipeCert', wipeFile);
      if (slipFile) fd.append('disposalSlip', slipFile);
      return api.post(`/assets/${id}/decommission`, fd, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['asset', id] }); setShowDispose(false); alert('Asset decommissioned.'); },
    onError: (e: any) => alert(e.response?.data?.message ?? 'Decommission failed'),
  });

  const a = asset.data;
  if (!a) return <div>Loading…</div>;

  const qrUrl = `${api.defaults.baseURL}/assets/${id}/qr.png`;
  const labelUrl = `${api.defaults.baseURL}/assets/${id}/label.pdf`;

  function openWithAuth(url: string) {
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.blob())
      .then((b) => window.open(URL.createObjectURL(b), '_blank'));
  }

  return (
    <>
      <PageHeader
        title={a.assetTag}
        subtitle={`${a.sku.manufacturer} ${a.sku.model} - ${a.sku.category.name}`}
        actions={
          <>
            <button className="btn-ghost" onClick={() => openWithAuth(qrUrl)}><QrCode size={14}/>QR</button>
            <button className="btn-ghost" onClick={() => openWithAuth(labelUrl)}><Printer size={14}/>Print label</button>
            {hasPerm('repairs:write') &&
              <button className="btn-primary" onClick={() => setShowFault(!showFault)}><Wrench size={14}/>Log fault</button>}
            {hasPerm('assets:dispose') && a.status !== 'DISPOSED' &&
              <button className="btn-ghost text-rose-300" onClick={() => setShowDispose(!showDispose)}><Trash2 size={14}/>Decommission</button>}
          </>
        }
      />

      {showDispose && (
        <div className="card mb-4 p-4">
          <h3 className="mb-3 text-sm font-semibold text-white">Decommission asset</h3>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Reason</label>
              <select className="field" value={dispose.reason} onChange={(e) => setDispose({ ...dispose, reason: e.target.value })}>
                <option>OBSOLETE</option><option>FAULTY</option><option>LOST</option><option>SOLD</option><option>OTHER</option>
              </select></div>
            <div><label className="label">Disposal vendor</label>
              <input className="field" value={dispose.disposalVendor} onChange={(e) => setDispose({ ...dispose, disposalVendor: e.target.value })} placeholder="e.g. Desco Electronic Recyclers" /></div>
            <div className="col-span-2"><label className="label">Notes</label>
              <textarea className="field" rows={2} value={dispose.notes} onChange={(e) => setDispose({ ...dispose, notes: e.target.value })} /></div>
            <div><label className="label">Data wipe certificate (PDF / image)</label>
              <input type="file" className="field" accept="application/pdf,image/*" onChange={(e) => setWipeFile(e.target.files?.[0] ?? null)} /></div>
            <div><label className="label">Disposal slip</label>
              <input type="file" className="field" accept="application/pdf,image/*" onChange={(e) => setSlipFile(e.target.files?.[0] ?? null)} /></div>
          </div>
          <div className="mt-3 flex gap-2">
            <button className="btn-danger" disabled={doDispose.isPending} onClick={() => doDispose.mutate()}>
              <Trash2 size={14}/>{doDispose.isPending ? 'Disposing…' : 'Confirm decommission'}
            </button>
            <button className="btn-ghost" onClick={() => setShowDispose(false)}>Cancel</button>
          </div>
        </div>
      )}

      {showFault && (
        <div className="card mb-4 p-4">
          <h3 className="mb-2 text-sm font-semibold">Log a new fault</h3>
          <textarea className="field mb-2" placeholder="Describe the fault…" value={fault} onChange={(e) => setFault(e.target.value)} />
          <label className="mb-3 flex items-center gap-2 text-sm">
            <input type="checkbox" checked={warrantyClaim} onChange={(e) => setWarrantyClaim(e.target.checked)} />
            This is a warranty claim
          </label>
          <button className="btn-primary" disabled={!fault.trim() || logFault.isPending} onClick={() => logFault.mutate()}>
            {logFault.isPending ? 'Logging…' : 'Log fault'}
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section className="card lg:col-span-2 p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Overview</h2>
          <dl className="grid grid-cols-2 gap-4 text-sm">
            <div><dt className="text-xs text-slate-500">Status</dt><dd><Pill status={a.status} /></dd></div>
            <div><dt className="text-xs text-slate-500">Serial</dt><dd className="font-mono">{a.serialNo ?? '—'}</dd></div>
            <div><dt className="text-xs text-slate-500">Location</dt><dd>{a.location?.name ?? '—'}</dd></div>
            <div><dt className="text-xs text-slate-500">Assigned store</dt><dd>{a.assignedStore?.name ?? '—'}</dd></div>
            <div><dt className="text-xs text-slate-500">Purchase cost</dt><dd>{formatZAR(a.purchaseCostCents)}</dd></div>
            <div><dt className="text-xs text-slate-500">Current value</dt><dd>{formatZAR(a.currentValueCents)}</dd></div>
            <div><dt className="text-xs text-slate-500">Warranty expiry</dt><dd>{a.warrantyExpiry ? new Date(a.warrantyExpiry).toLocaleDateString() : '—'}</dd></div>
            <div><dt className="text-xs text-slate-500">Supplier</dt><dd>{a.supplier?.name ?? '—'}</dd></div>
          </dl>

          {a.repairs?.length > 0 && (
            <>
              <h2 className="mb-2 mt-6 text-sm font-semibold text-white">Repairs</h2>
              <ul className="divide-y divide-ink-500/30">
                {a.repairs.map((r: any) => (
                  <li key={r.id} className="flex items-center justify-between py-2 text-sm">
                    <div>
                      <span className="font-mono text-xs text-ink-200">{r.code}</span>
                      <span className="ml-2 text-ink-100">{r.faultDesc}</span>
                    </div>
                    <Pill status={r.status} />
                  </li>
                ))}
              </ul>
            </>
          )}

          {a.tickets?.length > 0 && (
            <>
              <h2 className="mb-2 mt-6 text-sm font-semibold text-white">Helpdesk tickets</h2>
              <ul className="divide-y divide-ink-500/30">
                {a.tickets.map((t: any) => (
                  <li key={t.id} className="py-2 text-sm">
                    <div className="flex items-center justify-between">
                      <span className="font-mono text-xs text-ink-200">{t.system}/{t.ticketExternalId}</span>
                      <span className={t.closedAt ? 'pill-slate' : 'pill-amber'}>
                        {t.closedAt ? 'Closed' : 'Open'}
                      </span>
                    </div>
                    <div className="text-ink-100">{t.summary}</div>
                    <div className="text-[11px] text-ink-200">Opened {new Date(t.openedAt).toLocaleString()}</div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </section>

        <section className="card p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">History</h2>
          <ul className="space-y-3">
            {a.history?.map((h: any) => (
              <li key={h.id} className="border-l-2 border-brand-300 pl-3">
                <div className="text-sm font-medium">{h.eventType.replaceAll('_', ' ')}</div>
                <div className="text-xs text-slate-500">{new Date(h.occurredAt).toLocaleString()}</div>
                {h.fromLoc && <div className="text-xs text-slate-500">From: {h.fromLoc.name}</div>}
                {h.toLoc && <div className="text-xs text-slate-500">To: {h.toLoc.name}</div>}
                {h.notes && <div className="text-xs italic text-slate-600">"{h.notes}"</div>}
              </li>
            ))}
            {a.history?.length === 0 && <div className="text-sm text-slate-500">No history yet</div>}
          </ul>
        </section>
      </div>
    </>
  );
}
