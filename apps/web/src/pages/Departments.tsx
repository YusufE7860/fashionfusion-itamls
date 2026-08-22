import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { PageHeader } from '@/components/PageHeader';
import { useAuth } from '@/store/auth';
import { Building2, Check, Pencil, Plus, RefreshCw, Trash2, X } from 'lucide-react';

type Dept = {
  id: string; code: string; name: string; description?: string;
  sortOrder: number; isActive: boolean;
  _count?: { assets: number };
};

export function Departments() {
  const qc = useQueryClient();
  const hasPerm = useAuth((s) => s.hasPermission);
  const canManage = hasPerm('departments:manage');

  const [showInactive, setShowInactive] = useState(false);
  const depts = useQuery({
    queryKey: ['departments', showInactive],
    queryFn: () => api.get<Dept[]>('/departments', { params: { includeInactive: showInactive } }).then((r) => r.data),
  });

  const [showAdd, setShowAdd] = useState(false);
  const [addForm, setAddForm] = useState({ code: '', name: '', description: '', sortOrder: 100 });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editForm, setEditForm] = useState<Partial<Dept>>({});

  const create = useMutation({
    mutationFn: () => api.post('/departments', addForm).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['departments'] });
      setShowAdd(false); setAddForm({ code: '', name: '', description: '', sortOrder: 100 });
    },
  });
  const update = useMutation({
    mutationFn: (id: string) => api.patch(`/departments/${id}`, editForm).then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['departments'] }); setEditingId(null); },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/departments/${id}`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['departments'] }),
  });

  return (
    <>
      <PageHeader
        title="HQ Departments"
        subtitle="Departments used to assign Head Office assets — editable, sort order controls display order in dropdowns"
        actions={
          <>
            <button className="btn-ghost" onClick={() => depts.refetch()}><RefreshCw size={13} />Refresh</button>
            <label className="flex items-center gap-1 text-xs text-ink-200">
              <input type="checkbox" checked={showInactive} onChange={(e) => setShowInactive(e.target.checked)} />
              Show inactive
            </label>
            {canManage && <button className="btn-primary" onClick={() => setShowAdd(!showAdd)}><Plus size={13} />Add department</button>}
          </>
        }
      />

      {showAdd && canManage && (
        <section className="card mb-4 p-4">
          <h3 className="mb-2 text-sm font-semibold text-slate-700">New department</h3>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <div><label className="label">Code (optional)</label>
              <input className="field font-mono" placeholder="auto from name" value={addForm.code} onChange={(e) => setAddForm({ ...addForm, code: e.target.value.toUpperCase() })} /></div>
            <div><label className="label">Name *</label>
              <input className="field" value={addForm.name} onChange={(e) => setAddForm({ ...addForm, name: e.target.value })} /></div>
            <div><label className="label">Sort order</label>
              <input type="number" className="field" value={addForm.sortOrder} onChange={(e) => setAddForm({ ...addForm, sortOrder: +e.target.value })} /></div>
            <div><label className="label">Description</label>
              <input className="field" value={addForm.description} onChange={(e) => setAddForm({ ...addForm, description: e.target.value })} /></div>
          </div>
          <div className="mt-3 flex gap-2">
            <button className="btn-primary" disabled={!addForm.name.trim() || create.isPending} onClick={() => create.mutate()}>
              {create.isPending ? 'Adding…' : 'Add'}
            </button>
            <button className="btn-ghost" onClick={() => setShowAdd(false)}>Cancel</button>
          </div>
          {create.isError && <div className="mt-2 text-xs text-rose-600">{(create.error as any)?.response?.data?.message ?? 'Failed'}</div>}
        </section>
      )}

      <section className="card p-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="th text-left">Code</th>
                <th className="th text-left">Name</th>
                <th className="th text-left">Description</th>
                <th className="th text-right">Sort</th>
                <th className="th text-right">Assets</th>
                <th className="th text-left">Status</th>
                <th className="th text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {depts.data?.map((d) => (
                <tr key={d.id} className="border-b border-ink-500/20">
                  {editingId === d.id ? (
                    <>
                      <td className="py-2 font-mono text-xs">{d.code}</td>
                      <td className="py-2"><input className="field" value={editForm.name ?? ''} onChange={(e) => setEditForm({ ...editForm, name: e.target.value })} /></td>
                      <td className="py-2"><input className="field" value={editForm.description ?? ''} onChange={(e) => setEditForm({ ...editForm, description: e.target.value })} /></td>
                      <td className="py-2"><input type="number" className="field" value={editForm.sortOrder ?? d.sortOrder} onChange={(e) => setEditForm({ ...editForm, sortOrder: +e.target.value })} /></td>
                      <td className="py-2 text-right text-xs">{d._count?.assets ?? 0}</td>
                      <td className="py-2">
                        <label className="flex items-center gap-1 text-xs">
                          <input type="checkbox" checked={editForm.isActive ?? d.isActive} onChange={(e) => setEditForm({ ...editForm, isActive: e.target.checked })} />
                          Active
                        </label>
                      </td>
                      <td className="py-2 text-right">
                        <button className="btn-primary" onClick={() => update.mutate(d.id)}><Check size={12} /></button>
                        <button className="btn-ghost ml-1" onClick={() => setEditingId(null)}><X size={12} /></button>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="py-2 font-mono text-xs">{d.code}</td>
                      <td className="py-2 font-semibold">{d.name}</td>
                      <td className="py-2 text-xs text-ink-300">{d.description ?? '—'}</td>
                      <td className="py-2 text-right text-xs">{d.sortOrder}</td>
                      <td className="py-2 text-right text-xs">{d._count?.assets ?? 0}</td>
                      <td className="py-2 text-xs">
                        {d.isActive
                          ? <span className="rounded bg-emerald-50 px-2 py-0.5 text-[11px] text-emerald-700 ring-1 ring-emerald-200">Active</span>
                          : <span className="rounded bg-slate-100 px-2 py-0.5 text-[11px] text-slate-500 ring-1 ring-slate-300">Inactive</span>}
                      </td>
                      <td className="py-2 text-right">
                        {canManage && (
                          <div className="flex justify-end gap-1">
                            <button className="btn-ghost" title="Edit"
                              onClick={() => { setEditingId(d.id); setEditForm({ name: d.name, description: d.description, sortOrder: d.sortOrder, isActive: d.isActive }); }}>
                              <Pencil size={12} />
                            </button>
                            <button className="btn-ghost text-rose-500" title={d._count?.assets ? 'Has assets — will be marked inactive instead of deleted' : 'Delete'}
                              onClick={() => remove.mutate(d.id)}>
                              <Trash2 size={12} />
                            </button>
                          </div>
                        )}
                      </td>
                    </>
                  )}
                </tr>
              ))}
              {depts.data?.length === 0 && (
                <tr><td colSpan={7} className="py-6 text-center text-xs text-ink-300">
                  <Building2 size={24} className="mx-auto mb-2 opacity-40" />
                  No departments yet.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
