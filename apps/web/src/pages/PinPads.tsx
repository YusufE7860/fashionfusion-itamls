import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { PageHeader } from '@/components/PageHeader';
import { useAuth } from '@/store/auth';
import {
  CheckCircle2, Download, PackageCheck, PackageX, RefreshCw, Search, StickyNote, Plus,
} from 'lucide-react';

type Pad = {
  id: string; serialNo: string; model?: string; manufacturer: string;
  currentStoreId?: string; currentStoreCode?: string; currentPcName?: string;
  status: string; firstDetectedAt: string; lastDetectedAt: string;
  markedMissingAt?: string;
  receivedFromNedbankAt?: string; receivedRef?: string;
  returnedToNedbankAt?: string; returnRef?: string;
  notes?: string;
};
type Store = { id: string; code: string; name: string };

const STATUS_LABELS: Record<string, { label: string; cls: string }> = {
  DETECTED: { label: 'Detected',  cls: 'bg-sky-50 text-sky-700 ring-1 ring-sky-200' },
  ASSIGNED: { label: 'Assigned',  cls: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200' },
  RETURNED: { label: 'Returned',  cls: 'bg-slate-100 text-slate-600 ring-1 ring-slate-300' },
  MISSING:  { label: 'Missing',   cls: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200' },
  UNKNOWN:  { label: 'Unknown',   cls: 'bg-amber-50 text-amber-800 ring-1 ring-amber-200' },
};

export function PinPads() {
  const qc = useQueryClient();
  const token = useAuth((s) => s.token);
  const hasPerm = useAuth((s) => s.hasPermission);
  const canWrite = hasPerm('pinpads:write');

  const [storeFilter, setStoreFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [q, setQ] = useState('');

  const stores = useQuery({ queryKey: ['stores'], queryFn: () => api.get<Store[]>('/stores').then((r) => r.data) });
  const pads = useQuery({
    queryKey: ['pinpads', storeFilter, statusFilter, q],
    queryFn: () => api.get<Pad[]>('/pinpads', {
      params: { storeId: storeFilter || undefined, status: statusFilter || undefined, q: q || undefined },
    }).then((r) => r.data),
  });
  const summary = useQuery({ queryKey: ['pinpad-summary'], queryFn: () => api.get<Record<string, number>>('/pinpads/summary').then((r) => r.data) });

  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ serialNo: '', model: '', storeId: '', receivedRef: '', receivedAt: '', notes: '' });

  const invalidateAll = () => {
    qc.invalidateQueries({ queryKey: ['pinpads'] });
    qc.invalidateQueries({ queryKey: ['pinpad-summary'] });
  };

  const confirm    = useMutation({ mutationFn: (id: string) => api.post(`/pinpads/${id}/confirm`).then((r) => r.data), onSuccess: invalidateAll });
  const create     = useMutation({
    mutationFn: () => api.post('/pinpads', addForm).then((r) => r.data),
    onSuccess: () => { invalidateAll(); setShowAdd(false); setAddForm({ serialNo: '', model: '', storeId: '', receivedRef: '', receivedAt: '', notes: '' }); },
  });
  const [returnDlg, setReturnDlg] = useState<{ id: string; ref: string; date: string; notes: string } | null>(null);
  const doReturn = useMutation({
    mutationFn: () => api.post(`/pinpads/${returnDlg!.id}/return`, {
      returnRef: returnDlg!.ref, returnedAt: returnDlg!.date, notes: returnDlg!.notes,
    }).then((r) => r.data),
    onSuccess: () => { invalidateAll(); setReturnDlg(null); },
  });

  function downloadCsv() {
    const params = new URLSearchParams();
    if (storeFilter)  params.set('storeId', storeFilter);
    if (statusFilter) params.set('status',  statusFilter);
    if (q)            params.set('q',       q);
    fetch(`${api.defaults.baseURL}/pinpads/export.csv?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.blob())
      .then((b) => {
        const url = URL.createObjectURL(b);
        const a = document.createElement('a');
        a.href = url; a.download = `pinpads-${new Date().toISOString().slice(0, 10)}.csv`; a.click();
      });
  }

  const counts = useMemo(() => summary.data ?? {}, [summary.data]);

  return (
    <>
      <PageHeader
        title="Verifone PIN Pads"
        subtitle="Auto-detected via the till-side agent — Nedbank Verifone devices (USB VID 11CA)"
        actions={
          <>
            <button className="btn-ghost" onClick={() => pads.refetch()}><RefreshCw size={13} />Refresh</button>
            <button className="btn-primary" onClick={downloadCsv}><Download size={13} />Export CSV for Nedbank</button>
            {canWrite && <button className="btn-ghost" onClick={() => setShowAdd(!showAdd)}><Plus size={13} />Manual entry</button>}
          </>
        }
      />

      {/* Status summary */}
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5">
        {['DETECTED', 'ASSIGNED', 'MISSING', 'UNKNOWN', 'RETURNED'].map((s) => (
          <button key={s}
            onClick={() => setStatusFilter(statusFilter === s ? '' : s)}
            className={`card p-3 text-left transition-all hover:border-brand-400 ${statusFilter === s ? 'ring-2 ring-brand-400' : ''}`}>
            <div className="text-[11px] uppercase tracking-wider text-ink-300">{STATUS_LABELS[s].label}</div>
            <div className="text-2xl font-bold text-ink-50">{counts[s] ?? 0}</div>
          </button>
        ))}
      </div>

      {/* Filters */}
      <section className="card mb-4 p-3">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <div>
            <label className="label">Store</label>
            <select className="field" value={storeFilter} onChange={(e) => setStoreFilter(e.target.value)}>
              <option value="">All stores</option>
              {stores.data?.map((s) => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="label">Search (serial / model / notes / store code)</label>
            <div className="relative">
              <Search size={13} className="absolute left-2 top-2.5 text-ink-300" />
              <input className="field pl-7" value={q} onChange={(e) => setQ(e.target.value)} placeholder="e.g. 33012345 or FF-Empangeni" />
            </div>
          </div>
          <div className="flex items-end">
            <button className="btn-ghost w-full" onClick={() => { setStoreFilter(''); setStatusFilter(''); setQ(''); }}>Clear filters</button>
          </div>
        </div>
      </section>

      {/* Add form */}
      {showAdd && canWrite && (
        <section className="card mb-4 p-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-700">Manual PIN pad entry</h3>
          <p className="mb-3 text-xs text-ink-300">Use this only for pads that aren't currently plugged in (e.g. spares in a drawer or units in transit). Anything connected to a till gets picked up automatically on the next inventory push.</p>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div><label className="label">Serial number *</label>
              <input className="field font-mono" value={addForm.serialNo} onChange={(e) => setAddForm({ ...addForm, serialNo: e.target.value })} /></div>
            <div><label className="label">Model</label>
              <input className="field" placeholder="e.g. VX520, P400" value={addForm.model} onChange={(e) => setAddForm({ ...addForm, model: e.target.value })} /></div>
            <div><label className="label">Store</label>
              <select className="field" value={addForm.storeId} onChange={(e) => setAddForm({ ...addForm, storeId: e.target.value })}>
                <option value="">Unassigned (spare)</option>
                {stores.data?.map((s) => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
              </select></div>
            <div><label className="label">Nedbank delivery ref</label>
              <input className="field" value={addForm.receivedRef} onChange={(e) => setAddForm({ ...addForm, receivedRef: e.target.value })} /></div>
            <div><label className="label">Received on</label>
              <input type="date" className="field" value={addForm.receivedAt} onChange={(e) => setAddForm({ ...addForm, receivedAt: e.target.value })} /></div>
            <div><label className="label">Notes</label>
              <input className="field" value={addForm.notes} onChange={(e) => setAddForm({ ...addForm, notes: e.target.value })} /></div>
          </div>
          <div className="mt-3 flex gap-2">
            <button className="btn-primary" disabled={!addForm.serialNo.trim() || create.isPending} onClick={() => create.mutate()}>
              {create.isPending ? 'Adding…' : 'Add pad'}
            </button>
            <button className="btn-ghost" onClick={() => setShowAdd(false)}>Cancel</button>
          </div>
          {create.isError && <div className="mt-2 text-xs text-rose-600">{(create.error as any)?.response?.data?.message ?? 'Failed'}</div>}
        </section>
      )}

      {/* Return dialog */}
      {returnDlg && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4">
          <div className="w-full max-w-md rounded-xl bg-white p-4 shadow-xl">
            <h3 className="mb-2 text-sm font-semibold">Mark as returned to Nedbank</h3>
            <div className="grid grid-cols-1 gap-3">
              <div><label className="label">Nedbank return reference</label>
                <input className="field" value={returnDlg.ref} onChange={(e) => setReturnDlg({ ...returnDlg, ref: e.target.value })} /></div>
              <div><label className="label">Returned on</label>
                <input type="date" className="field" value={returnDlg.date} onChange={(e) => setReturnDlg({ ...returnDlg, date: e.target.value })} /></div>
              <div><label className="label">Notes</label>
                <textarea className="field" rows={2} value={returnDlg.notes} onChange={(e) => setReturnDlg({ ...returnDlg, notes: e.target.value })} /></div>
            </div>
            <div className="mt-3 flex gap-2">
              <button className="btn-primary" disabled={doReturn.isPending} onClick={() => doReturn.mutate()}>
                {doReturn.isPending ? 'Saving…' : 'Confirm return'}
              </button>
              <button className="btn-ghost" onClick={() => setReturnDlg(null)}>Cancel</button>
            </div>
          </div>
        </div>
      )}

      {/* Table */}
      <section className="card p-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="th text-left">Serial</th>
                <th className="th text-left">Model</th>
                <th className="th text-left">Store</th>
                <th className="th text-left">PC</th>
                <th className="th text-left">Status</th>
                <th className="th text-left">Last seen</th>
                <th className="th text-left">Nedbank refs</th>
                <th className="th text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pads.data?.map((p) => {
                const s = STATUS_LABELS[p.status] ?? STATUS_LABELS.UNKNOWN;
                return (
                  <tr key={p.id} className="border-b border-ink-500/20">
                    <td className="py-2 font-mono text-xs">{p.serialNo}</td>
                    <td className="py-2 text-xs">{p.model ?? '—'}</td>
                    <td className="py-2 text-xs">{p.currentStoreCode ?? '—'}</td>
                    <td className="py-2 text-xs">{p.currentPcName ?? '—'}</td>
                    <td className="py-2"><span className={`rounded px-2 py-0.5 text-[11px] font-medium ${s.cls}`}>{s.label}</span></td>
                    <td className="py-2 text-xs">{new Date(p.lastDetectedAt).toLocaleDateString()}</td>
                    <td className="py-2 text-[11px]">
                      {p.receivedRef && <div>In: <span className="font-mono">{p.receivedRef}</span></div>}
                      {p.returnRef  && <div>Out: <span className="font-mono">{p.returnRef}</span></div>}
                      {!p.receivedRef && !p.returnRef && '—'}
                    </td>
                    <td className="py-2 text-right">
                      {canWrite && (
                        <div className="flex justify-end gap-1">
                          {(p.status === 'DETECTED' || p.status === 'UNKNOWN') && (
                            <button className="btn-ghost" title="Confirm assignment" onClick={() => confirm.mutate(p.id)}>
                              <CheckCircle2 size={12} />Confirm
                            </button>
                          )}
                          {p.status !== 'RETURNED' && (
                            <button className="btn-ghost" title="Mark returned to Nedbank"
                              onClick={() => setReturnDlg({ id: p.id, ref: '', date: new Date().toISOString().slice(0,10), notes: '' })}>
                              <PackageX size={12} />Return
                            </button>
                          )}
                        </div>
                      )}
                    </td>
                  </tr>
                );
              })}
              {pads.data?.length === 0 && (
                <tr><td colSpan={8} className="py-6 text-center text-xs text-ink-300">
                  <PackageCheck size={24} className="mx-auto mb-2 opacity-40" />
                  No PIN pads reported yet. Once the agents run their next inventory push, detected Verifone devices will appear here.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
