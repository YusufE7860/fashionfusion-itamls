import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { PageHeader } from '@/components/PageHeader';
import { useAuth } from '@/store/auth';
import { Plus, Save, Trash2, X, Store as StoreIcon, ChevronDown, ChevronRight } from 'lucide-react';

/**
 * Area Managers are NOT ITAMLS users. They are records with an email that
 * the Ops app references when a store logs a ticket. ITAMLS uses the AM's
 * assignedTechId to decide which technician should pick the ticket up.
 */
export function AreaManagers() {
  const qc = useQueryClient();
  const hasPerm = useAuth((s) => s.hasPermission);
  const canWrite = hasPerm('stores:write');

  const [showInactive, setShowInactive] = useState(false);
  const items = useQuery({
    queryKey: ['area-managers', showInactive],
    queryFn: () => api.get('/area-managers', { params: { includeInactive: showInactive ? 'true' : 'false' } }).then((r) => r.data),
  });
  const regions = useQuery({ queryKey: ['regions'], queryFn: () => api.get('/regions').then((r) => r.data) });
  const users   = useQuery({ queryKey: ['users'],   queryFn: () => api.get('/users').then((r) => r.data).catch(() => []) });

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing]   = useState<any | null>(null);
  const empty = { fullName: '', email: '', phone: '', regionId: '', assignedTechId: '', isActive: true, notes: '' };
  const [form, setForm] = useState<any>(empty);
  const [openId, setOpenId] = useState<string | null>(null);

  const techs = useMemo(() => (users.data ?? []).filter((u: any) =>
    u.isActive && ['ADMINISTRATOR', 'IT_MANAGER', 'TECHNICIAN'].includes(u.role?.code)
  ), [users.data]);

  const save = useMutation({
    mutationFn: () => editing
      ? api.patch(`/area-managers/${editing.id}`, form).then((r) => r.data)
      : api.post('/area-managers', form).then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['area-managers'] }); setShowForm(false); setEditing(null); setForm(empty); },
    onError: (e: any) => alert(e?.response?.data?.message ?? 'Save failed'),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/area-managers/${id}`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['area-managers'] }),
  });

  return (
    <>
      <PageHeader
        title="Area managers"
        subtitle="People who oversee stores. They don't log in — tickets route via them to a technician."
        actions={
          <>
            <label className="flex items-center gap-1 text-xs text-ink-200">
              <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
              Show inactive
            </label>
            {canWrite && (
              <button className="btn-primary" onClick={() => { setShowForm(true); setEditing(null); setForm(empty); }}>
                <Plus size={13}/>New area manager
              </button>
            )}
          </>
        }
      />

      {showForm && canWrite && (
        <section className="card mb-4 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-700">{editing ? `Edit ${editing.fullName}` : 'New area manager'}</h3>
            <button className="btn-ghost" onClick={() => { setShowForm(false); setEditing(null); setForm(empty); }}><X size={13}/></button>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div>
              <label className="label">Full name *</label>
              <input className="field" value={form.fullName} onChange={(e) => setForm({ ...form, fullName: e.target.value })} />
            </div>
            <div>
              <label className="label">Email *</label>
              <input type="email" className="field" value={form.email}
                onChange={(e) => setForm({ ...form, email: e.target.value })} />
            </div>
            <div>
              <label className="label">Phone</label>
              <input className="field" value={form.phone} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
            </div>
            <div>
              <label className="label">Region</label>
              <select className="field" value={form.regionId}
                onChange={(e) => setForm({ ...form, regionId: e.target.value })}>
                <option value="">— none —</option>
                {regions.data?.map((r: any) => <option key={r.id} value={r.id}>{r.code} — {r.name}</option>)}
              </select>
            </div>
            <div className="md:col-span-2">
              <label className="label">Reports to (technician)</label>
              <select className="field" value={form.assignedTechId}
                onChange={(e) => setForm({ ...form, assignedTechId: e.target.value })}>
                <option value="">— unassigned —</option>
                {techs.map((t: any) => <option key={t.id} value={t.id}>{t.fullName} ({t.role?.code})</option>)}
              </select>
              <p className="mt-1 text-[11px] text-ink-300">
                Tickets logged for this AM's stores auto-assign to this technician.
              </p>
            </div>
            <div className="md:col-span-3">
              <label className="label">Notes</label>
              <textarea className="field text-sm" rows={2} value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-1 text-sm">
                <input type="checkbox" checked={form.isActive}
                  onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
                Active
              </label>
            </div>
            <div className="md:col-span-3">
              <button className="btn-primary"
                disabled={!form.fullName || !form.email || save.isPending}
                onClick={() => save.mutate()}>
                <Save size={12}/>{save.isPending ? 'Saving…' : editing ? 'Save' : 'Create'}
              </button>
            </div>
          </div>
        </section>
      )}

      <section className="card p-0">
        <ul className="divide-y divide-ink-500/10">
          {items.data?.length === 0 && (
            <li className="p-6 text-center text-sm text-ink-300">No area managers yet.</li>
          )}
          {items.data?.map((am: any) => (
            <li key={am.id}>
              <button className="flex w-full items-center justify-between gap-3 p-3 text-left" onClick={() => setOpenId(openId === am.id ? null : am.id)}>
                <div className="flex items-center gap-3">
                  {openId === am.id ? <ChevronDown size={14}/> : <ChevronRight size={14}/>}
                  <div>
                    <div className="font-semibold text-ink-100">{am.fullName}</div>
                    <div className="text-xs text-ink-300">{am.email}{am.phone && ` · ${am.phone}`}</div>
                  </div>
                </div>
                <div className="flex items-center gap-2 text-xs">
                  {am.region && <span className="rounded bg-slate-100 px-2 py-0.5 font-mono">{am.region.code}</span>}
                  {am.assignedTech && <span className="rounded bg-brand-50 px-2 py-0.5 text-brand-700">→ {am.assignedTech.fullName}</span>}
                  <span className="flex items-center gap-1 text-ink-300"><StoreIcon size={11}/>{am._count?.stores ?? 0}</span>
                  {!am.isActive && <span className="rounded bg-rose-100 px-2 py-0.5 text-rose-700">Inactive</span>}
                </div>
              </button>
              {openId === am.id && (
                <AreaManagerDetail am={am} canWrite={canWrite}
                  onEdit={() => { setEditing(am); setShowForm(true); setForm({
                    fullName: am.fullName, email: am.email, phone: am.phone ?? '',
                    regionId: am.regionId ?? '', assignedTechId: am.assignedTechId ?? '',
                    isActive: am.isActive, notes: am.notes ?? '',
                  }); }}
                  onDelete={() => { if (confirm(`Delete ${am.fullName}?`)) remove.mutate(am.id); }} />
              )}
            </li>
          ))}
        </ul>
      </section>
    </>
  );
}

function AreaManagerDetail({ am, canWrite, onEdit, onDelete }: { am: any; canWrite: boolean; onEdit: () => void; onDelete: () => void }) {
  const qc = useQueryClient();
  const detail = useQuery({
    queryKey: ['area-manager', am.id],
    queryFn: () => api.get(`/area-managers/${am.id}`).then((r) => r.data),
  });
  const stores = useQuery({ queryKey: ['stores'], queryFn: () => api.get('/stores').then((r) => r.data) });

  const [selectedStoreIds, setSelectedStoreIds] = useState<Set<string>>(new Set());
  useMemo(() => {
    if (detail.data) setSelectedStoreIds(new Set((detail.data.stores ?? []).map((s: any) => s.id)));
  }, [detail.data]);

  const [q, setQ] = useState('');
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (stores.data ?? []).filter((s: any) =>
      !needle || s.code.toLowerCase().includes(needle) || s.name.toLowerCase().includes(needle)
    );
  }, [stores.data, q]);

  const save = useMutation({
    mutationFn: () => api.post(`/area-managers/${am.id}/stores`, { storeIds: [...selectedStoreIds] }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['area-manager', am.id] });
      qc.invalidateQueries({ queryKey: ['area-managers'] });
    },
  });

  return (
    <div className="border-t border-ink-500/10 bg-slate-50/40 p-4">
      {canWrite && (
        <div className="mb-3 flex items-center justify-end gap-2">
          <button className="btn-ghost" onClick={onEdit}>Edit details</button>
          <button className="btn-ghost text-rose-500" onClick={onDelete}><Trash2 size={12}/>Delete</button>
        </div>
      )}
      <h4 className="mb-2 text-xs font-bold uppercase tracking-wider text-ink-300">Stores covered</h4>
      <input className="field mb-2" placeholder="Search stores…" value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="max-h-80 overflow-auto rounded border border-ink-500/20 bg-white">
        <ul className="divide-y divide-ink-500/10">
          {filtered.map((s: any) => (
            <li key={s.id}>
              <label className="flex cursor-pointer items-center gap-2 px-3 py-1.5 text-xs hover:bg-brand-50/30">
                <input type="checkbox" className="h-4 w-4 accent-brand-500"
                  checked={selectedStoreIds.has(s.id)}
                  disabled={!canWrite}
                  onChange={(e) => {
                    const next = new Set(selectedStoreIds);
                    e.target.checked ? next.add(s.id) : next.delete(s.id);
                    setSelectedStoreIds(next);
                  }} />
                <span className="font-mono text-ink-100">{s.code}</span>
                <span className="text-ink-200">{s.name}</span>
                <span className="ml-auto text-[10px] text-ink-300">{s.region}</span>
              </label>
            </li>
          ))}
        </ul>
      </div>
      {canWrite && (
        <div className="mt-3">
          <button className="btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>
            <Save size={12}/>{save.isPending ? 'Saving…' : `Save ${selectedStoreIds.size} store(s)`}
          </button>
        </div>
      )}
    </div>
  );
}
