import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { PageHeader } from '@/components/PageHeader';
import { useAuth } from '@/store/auth';
import { Plus, Save, Trash2, X } from 'lucide-react';

export function Regions() {
  const qc = useQueryClient();
  const hasPerm = useAuth((s) => s.hasPermission);
  const canWrite = hasPerm('stores:write');

  const items = useQuery({ queryKey: ['regions'], queryFn: () => api.get('/regions').then((r) => r.data) });

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const empty = { code: '', name: '', isActive: true };
  const [form, setForm] = useState(empty);

  const save = useMutation({
    mutationFn: () => editing
      ? api.patch(`/regions/${editing.id}`, form).then((r) => r.data)
      : api.post('/regions', form).then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['regions'] }); setShowForm(false); setEditing(null); setForm(empty); },
    onError: (e: any) => alert(e?.response?.data?.message ?? 'Save failed'),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/regions/${id}`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['regions'] }),
    onError: (e: any) => alert(e?.response?.data?.message ?? 'Delete failed'),
  });

  return (
    <>
      <PageHeader
        title="Regions"
        subtitle="Geographic groupings for stores and area managers"
        actions={canWrite && (
          <button className="btn-primary" onClick={() => { setShowForm(true); setEditing(null); setForm(empty); }}>
            <Plus size={13}/>New region
          </button>
        )}
      />

      {showForm && canWrite && (
        <section className="card mb-4 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-700">{editing ? `Edit ${editing.code}` : 'New region'}</h3>
            <button className="btn-ghost" onClick={() => { setShowForm(false); setEditing(null); setForm(empty); }}><X size={13}/></button>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div>
              <label className="label">Code *</label>
              <input className="field font-mono" placeholder="GP" value={form.code}
                onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} />
            </div>
            <div className="md:col-span-2">
              <label className="label">Name *</label>
              <input className="field" placeholder="Gauteng" value={form.name}
                onChange={(e) => setForm({ ...form, name: e.target.value })} />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-1 text-sm">
                <input type="checkbox" checked={form.isActive}
                  onChange={(e) => setForm({ ...form, isActive: e.target.checked })} />
                Active
              </label>
            </div>
            <div className="md:col-span-3">
              <button className="btn-primary" disabled={!form.code || !form.name || save.isPending} onClick={() => save.mutate()}>
                <Save size={12}/>{save.isPending ? 'Saving…' : editing ? 'Save' : 'Create'}
              </button>
            </div>
          </div>
        </section>
      )}

      <section className="card p-4">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="th text-left">Code</th>
              <th className="th text-left">Name</th>
              <th className="th text-right">Stores</th>
              <th className="th text-right">Area managers</th>
              <th className="th text-left">Active</th>
              <th className="th text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.data?.length === 0 && (
              <tr><td colSpan={6} className="py-4 text-center text-xs text-ink-300">
                No regions yet. Click <b>New region</b> to add one.
              </td></tr>
            )}
            {items.data?.map((r: any) => (
              <tr key={r.id} className="border-b border-ink-500/10">
                <td className="py-2 font-mono">{r.code}</td>
                <td className="py-2">{r.name}</td>
                <td className="py-2 text-right">{r._count?.stores ?? 0}</td>
                <td className="py-2 text-right">{r._count?.areaManagers ?? 0}</td>
                <td className="py-2 text-xs">{r.isActive ? '✓' : '—'}</td>
                <td className="py-2 text-right">
                  {canWrite && (
                    <div className="flex justify-end gap-1">
                      <button className="btn-ghost" onClick={() => { setEditing(r); setShowForm(true); setForm({ code: r.code, name: r.name, isActive: r.isActive }); }}>Edit</button>
                      <button className="btn-ghost text-rose-500"
                        onClick={() => { if (confirm(`Delete region ${r.name}?`)) remove.mutate(r.id); }}>
                        <Trash2 size={12}/>
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
