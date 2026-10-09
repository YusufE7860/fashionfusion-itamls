import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { PageHeader } from '@/components/PageHeader';
import { Pill } from '@/components/Pill';
import { useAuth } from '@/store/auth';
import { CheckCircle2, AlertCircle, XCircle, HardDrive, Pencil, Trash2, ArrowRightLeft, Save, X } from 'lucide-react';

function StateIcon({ state }: { state: string }) {
  if (state === 'INSTALLED') return <CheckCircle2 className="text-emerald-600" size={18} />;
  if (state === 'PARTIAL')   return <AlertCircle className="text-amber-600" size={18} />;
  return <XCircle className="text-rose-600" size={18} />;
}

export function StoreDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const hasPerm = useAuth((s) => s.hasPermission);
  const canWrite = hasPerm('stores:write');

  const store = useQuery({
    queryKey: ['store', id],
    queryFn: () => api.get(`/stores/${id}`).then((r) => r.data),
    enabled: !!id,
  });
  const compliance = useQuery({
    queryKey: ['store-compliance', id],
    queryFn: () => api.get(`/stores/${id}/compliance`).then((r) => r.data),
    enabled: !!id,
  });

  const [editing, setEditing] = useState(false);
  const [transferring, setTransferring] = useState(false);

  if (!store.data) return <div>Loading…</div>;
  const s = store.data;

  return (
    <>
      <PageHeader
        title={`${s.code} – ${s.name}`}
        subtitle={`${s.region}  •  Template: ${s.template?.name ?? '—'}  •  Status: ${s.status}  •  ${s.entity ?? 'FASHION_FUSION'}`}
        actions={
          <>
            <Link to={`/stores/${id}/backups`} className="btn-ghost"><HardDrive size={14}/>Backups</Link>
            {canWrite && (
              <>
                <button className="btn-ghost" onClick={() => setEditing(true)}>
                  <Pencil size={13}/>Edit
                </button>
                <button className="btn-ghost" onClick={() => setTransferring(true)}>
                  <ArrowRightLeft size={13}/>Transfer stock
                </button>
                <DeleteStoreButton store={s} onDeleted={() => nav('/stores')} />
              </>
            )}
          </>
        }
      />

      {editing && (
        <EditStoreModal store={s} onClose={() => setEditing(false)}
          onSaved={() => { qc.invalidateQueries({ queryKey: ['store', id] }); setEditing(false); }} />
      )}
      {transferring && (
        <TransferStockModal fromStore={s} onClose={() => setTransferring(false)}
          onDone={() => { qc.invalidateQueries({ queryKey: ['store', id] }); setTransferring(false); }} />
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section className="card lg:col-span-2 overflow-hidden">
          <header className="border-b px-4 py-2 text-sm font-semibold text-slate-700">Standards compliance</header>
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr>
                <th className="th">Category</th>
                <th className="th text-right">Required</th>
                <th className="th text-right">Installed</th>
                <th className="th">Status</th>
              </tr>
            </thead>
            <tbody>
              {compliance.data?.map((c: any) => (
                <tr key={c.templateItemId} className="border-t">
                  <td className="td">{c.categoryName}</td>
                  <td className="td text-right">{c.requiredQty}</td>
                  <td className="td text-right">{c.installedQty}</td>
                  <td className="td">
                    <div className="flex items-center gap-2">
                      <StateIcon state={c.state} />
                      <span className="text-xs">{c.state}</span>
                    </div>
                  </td>
                </tr>
              ))}
              {(!compliance.data || compliance.data.length === 0) && (
                <tr><td className="td" colSpan={4}>No template assigned</td></tr>
              )}
            </tbody>
          </table>
        </section>

        <section className="card overflow-hidden">
          <header className="border-b px-4 py-2 text-sm font-semibold text-slate-700">Assets here ({s.assignedAssets?.length ?? 0})</header>
          <ul className="divide-y max-h-96 overflow-auto">
            {s.assignedAssets?.map((a: any) => (
              <li key={a.id} className="flex items-center justify-between px-4 py-2 text-sm">
                <span className="font-mono text-xs">{a.assetTag}</span>
                <span className="text-slate-600 truncate">{a.sku?.model ?? a.sku?.name}</span>
                <Pill status={a.status} />
              </li>
            ))}
            {s.assignedAssets?.length === 0 && (
              <li className="px-4 py-3 text-sm text-slate-500">No assets assigned yet</li>
            )}
          </ul>
        </section>
      </div>
    </>
  );
}

// ---------- Edit modal ----------
function EditStoreModal({ store, onClose, onSaved }: { store: any; onClose: () => void; onSaved: () => void }) {
  const [form, setForm] = useState({
    code: store.code, name: store.name, region: store.region,
    entity: store.entity ?? 'FASHION_FUSION', status: store.status,
    templateId: store.templateId ?? '',
    openingDate: store.openingDate ? store.openingDate.slice(0, 10) : '',
  });
  const templates = useQuery({ queryKey: ['store-templates'], queryFn: () => api.get('/admin/templates').then((r) => r.data).catch(() => []) });

  const save = useMutation({
    mutationFn: () => api.patch(`/stores/${store.id}`, {
      ...form,
      templateId: form.templateId || null,
      openingDate: form.openingDate || null,
    }).then((r) => r.data),
    onSuccess: onSaved,
    onError: (e: any) => alert(e?.response?.data?.message ?? 'Save failed'),
  });

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-xl rounded-lg bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">Edit store</h3>
          <button className="btn-ghost" onClick={onClose}><X size={14}/></button>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <label className="label">Code</label>
            <input className="field font-mono" value={form.code}
              onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} />
          </div>
          <div>
            <label className="label">Name</label>
            <input className="field" value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })} />
          </div>
          <div>
            <label className="label">Region</label>
            <input className="field" value={form.region}
              onChange={(e) => setForm({ ...form, region: e.target.value })} />
          </div>
          <div>
            <label className="label">Brand</label>
            <select className="field" value={form.entity}
              onChange={(e) => setForm({ ...form, entity: e.target.value })}>
              <option value="FASHION_FUSION">Fashion Fusion</option>
              <option value="EVLV">Evolve</option>
            </select>
          </div>
          <div>
            <label className="label">Status</label>
            <select className="field" value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value })}>
              <option value="PLANNED">Planned</option>
              <option value="OPEN">Open</option>
              <option value="REMODEL">Remodel</option>
              <option value="CLOSED">Closed</option>
            </select>
          </div>
          <div>
            <label className="label">Template</label>
            <select className="field" value={form.templateId}
              onChange={(e) => setForm({ ...form, templateId: e.target.value })}>
              <option value="">— none —</option>
              {templates.data?.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Opening date</label>
            <input type="date" className="field" value={form.openingDate}
              onChange={(e) => setForm({ ...form, openingDate: e.target.value })} />
          </div>
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>
            <Save size={13}/>{save.isPending ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ---------- Delete button ----------
function DeleteStoreButton({ store, onDeleted }: { store: any; onDeleted: () => void }) {
  const [showForce, setShowForce] = useState(false);
  const remove = useMutation({
    mutationFn: (force?: boolean) => api.delete(`/stores/${store.id}${force ? '?force=true' : ''}`).then((r) => r.data),
    onSuccess: onDeleted,
    onError: (e: any) => {
      const msg = e?.response?.data?.message ?? 'Delete failed';
      // Server returned "has N assets still assigned" — offer the force path
      if (/still assigned/i.test(msg)) setShowForce(true);
      else alert(msg);
    },
  });

  if (showForce) {
    return (
      <div className="inline-flex items-center gap-1 rounded border border-rose-300 bg-rose-50 px-2 py-1 text-[11px] text-rose-700">
        <span>Store has assets. Transfer them first, or:</span>
        <button className="font-semibold underline"
          onClick={() => { if (confirm(`REALLY delete ${store.code}? Assets will become unassigned.`)) remove.mutate(true); }}>
          Force delete
        </button>
        <button className="ml-1" onClick={() => setShowForce(false)}>cancel</button>
      </div>
    );
  }

  return (
    <button className="btn-ghost text-rose-600"
      onClick={() => { if (confirm(`Delete store ${store.code}? This cannot be undone.`)) remove.mutate(false); }}>
      <Trash2 size={13}/>Delete
    </button>
  );
}

// ---------- Transfer stock modal ----------
function TransferStockModal({ fromStore, onClose, onDone }: { fromStore: any; onClose: () => void; onDone: () => void }) {
  const stores = useQuery({ queryKey: ['stores'], queryFn: () => api.get('/stores').then((r) => r.data) });
  const [toStoreId, setToStoreId] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [mode, setMode] = useState<'all' | 'some'>('all');
  const [note, setNote] = useState('');

  const transfer = useMutation({
    mutationFn: () => api.post('/stores/transfer-assets', {
      fromStoreId: fromStore.id,
      toStoreId,
      assetIds: mode === 'some' ? [...picked] : undefined,
      note: note || undefined,
    }).then((r) => r.data),
    onSuccess: (r) => { alert(`Moved ${r.moved} asset(s) from ${r.fromStore ?? fromStore.code} to ${r.toStore ?? ''}`); onDone(); },
    onError: (e: any) => alert(e?.response?.data?.message ?? 'Transfer failed'),
  });

  const assets = fromStore.assignedAssets ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-lg bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h3 className="text-lg font-semibold">Transfer stock from {fromStore.code}</h3>
          <button className="btn-ghost" onClick={onClose}><X size={14}/></button>
        </div>

        <div className="mb-3 grid grid-cols-1 gap-3 md:grid-cols-2">
          <div>
            <label className="label">Destination store</label>
            <select className="field" value={toStoreId} onChange={(e) => setToStoreId(e.target.value)}>
              <option value="">— pick a store —</option>
              {stores.data?.filter((s: any) => s.id !== fromStore.id).map((s: any) => (
                <option key={s.id} value={s.id}>{s.code} — {s.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="label">Note (optional)</label>
            <input className="field" placeholder="e.g. Gateway closure — moving to Pavilion"
              value={note} onChange={(e) => setNote(e.target.value)} />
          </div>
        </div>

        <div className="mb-2 flex items-center gap-3 text-xs">
          <label className="flex items-center gap-1">
            <input type="radio" checked={mode === 'all'} onChange={() => setMode('all')} />
            Move ALL {assets.length} assets
          </label>
          <label className="flex items-center gap-1">
            <input type="radio" checked={mode === 'some'} onChange={() => setMode('some')} />
            Pick which assets
          </label>
        </div>

        {mode === 'some' && (
          <div className="mb-3 max-h-72 overflow-auto rounded border border-ink-500/20">
            <ul className="divide-y divide-ink-500/10 text-xs">
              {assets.map((a: any) => (
                <li key={a.id}>
                  <label className="flex cursor-pointer items-center gap-2 px-3 py-1 hover:bg-brand-50/30">
                    <input type="checkbox" className="h-4 w-4 accent-brand-500"
                      checked={picked.has(a.id)}
                      onChange={(e) => {
                        const n = new Set(picked);
                        e.target.checked ? n.add(a.id) : n.delete(a.id);
                        setPicked(n);
                      }} />
                    <span className="font-mono">{a.assetTag}</span>
                    <span className="flex-1 truncate text-ink-300">{a.sku?.name ?? a.sku?.model ?? ''}</span>
                  </label>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary"
            disabled={!toStoreId || transfer.isPending || (mode === 'some' && picked.size === 0)}
            onClick={() => transfer.mutate()}>
            <ArrowRightLeft size={13}/>
            {transfer.isPending ? 'Transferring…' : `Transfer ${mode === 'all' ? assets.length : picked.size} asset(s)`}
          </button>
        </div>
      </div>
    </div>
  );
}
