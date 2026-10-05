import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { PageHeader } from '@/components/PageHeader';
import { useAuth } from '@/store/auth';
import { Plus, Save, Trash2, X, Check, Users as UsersIcon } from 'lucide-react';
import clsx from 'clsx';

/**
 * Reminders & tasks board. Any user sees reminders assigned to them + broadcast
 * reminders. Admins (users:manage) can create for anyone.
 */
export function Reminders() {
  const qc = useQueryClient();
  const hasPerm = useAuth((s) => s.hasPermission);
  const isAdmin = hasPerm('users:manage');
  const [showAll, setShowAll] = useState(false);
  const [includeCompleted, setIncludeCompleted] = useState(false);

  const items = useQuery({
    queryKey: ['reminders', showAll, includeCompleted],
    queryFn: () => api.get(showAll ? '/reminders/all' : '/reminders', {
      params: { includeCompleted: includeCompleted ? 'true' : 'false' },
    }).then((r) => r.data),
  });
  const users = useQuery({
    queryKey: ['users'], queryFn: () => api.get('/users').then((r) => r.data).catch(() => []),
    enabled: isAdmin,
  });

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const emptyForm = { title: '', notes: '', dueAt: '', priority: 'NORMAL', assignedToId: '' };
  const [form, setForm] = useState(emptyForm);

  const save = useMutation({
    mutationFn: () => {
      const body: any = {
        title: form.title,
        notes: form.notes || undefined,
        dueAt: form.dueAt || null,
        priority: form.priority,
        assignedToId: form.assignedToId || null,
      };
      return editing
        ? api.patch(`/reminders/${editing.id}`, body).then((r) => r.data)
        : api.post('/reminders', body).then((r) => r.data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['reminders'] });
      setShowForm(false); setEditing(null); setForm(emptyForm);
    },
  });
  const toggle = useMutation({
    mutationFn: ({ id, done }: { id: string; done: boolean }) =>
      api.post(`/reminders/${id}/${done ? 'complete' : 'uncomplete'}`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reminders'] }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/reminders/${id}`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['reminders'] }),
  });

  return (
    <>
      <PageHeader
        title="Reminders & tasks"
        subtitle={isAdmin ? 'Set tasks for yourself, your team, or broadcast to everyone' : 'Your reminders'}
        actions={
          <>
            {isAdmin && (
              <label className="flex items-center gap-1 text-xs text-ink-200">
                <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
                All users
              </label>
            )}
            <label className="flex items-center gap-1 text-xs text-ink-200">
              <input type="checkbox" checked={includeCompleted} onChange={(e) => setIncludeCompleted(e.target.checked)} />
              Show completed
            </label>
            <button className="btn-primary" onClick={() => { setShowForm(true); setEditing(null); setForm(emptyForm); }}>
              <Plus size={13}/>New reminder
            </button>
          </>
        }
      />

      {showForm && (
        <section className="card mb-4 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-700">{editing ? 'Edit reminder' : 'New reminder'}</h3>
            <button className="btn-ghost" onClick={() => { setShowForm(false); setEditing(null); setForm(emptyForm); }}><X size={13}/></button>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <div className="md:col-span-2">
              <label className="label">Title *</label>
              <input className="field" value={form.title}
                onChange={(e) => setForm({ ...form, title: e.target.value })}
                placeholder="e.g. Patch all POS PCs this Friday" />
            </div>
            <div>
              <label className="label">Due</label>
              <input type="date" className="field" value={form.dueAt}
                onChange={(e) => setForm({ ...form, dueAt: e.target.value })} />
            </div>
            <div>
              <label className="label">Priority</label>
              <select className="field" value={form.priority}
                onChange={(e) => setForm({ ...form, priority: e.target.value })}>
                <option value="LOW">Low</option>
                <option value="NORMAL">Normal</option>
                <option value="HIGH">High</option>
                <option value="URGENT">Urgent</option>
              </select>
            </div>
            {isAdmin && (
              <div className="md:col-span-2">
                <label className="label">Assign to</label>
                <select className="field" value={form.assignedToId}
                  onChange={(e) => setForm({ ...form, assignedToId: e.target.value })}>
                  <option value="">— Everyone (broadcast) —</option>
                  {users.data?.filter?.((u: any) => u.isActive)?.map((u: any) => (
                    <option key={u.id} value={u.id}>{u.fullName} ({u.role?.code})</option>
                  ))}
                </select>
              </div>
            )}
            <div className="md:col-span-4">
              <label className="label">Notes</label>
              <textarea className="field text-sm" rows={3} value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })} />
            </div>
            <div className="md:col-span-4">
              <button className="btn-primary" disabled={!form.title.trim() || save.isPending}
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
            <li className="p-6 text-center text-sm text-ink-300">
              Nothing here. Click <b>New reminder</b> to add one.
            </li>
          )}
          {items.data?.map((r: any) => {
            const done = !!r.completedAt;
            const overdue = r.dueAt && !done && new Date(r.dueAt) < new Date();
            return (
              <li key={r.id} className={clsx('flex items-start gap-3 p-3', done && 'opacity-50')}>
                <input type="checkbox" className="mt-1 h-4 w-4 accent-brand-500 cursor-pointer"
                  checked={done} onChange={(e) => toggle.mutate({ id: r.id, done: e.target.checked })} />
                <div className="flex-1">
                  <div className={clsx('text-sm', done ? 'line-through text-ink-300' : 'text-ink-100 font-medium')}>
                    {r.title}
                  </div>
                  {r.notes && <div className="mt-0.5 text-xs text-ink-300 whitespace-pre-wrap">{r.notes}</div>}
                  <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-ink-300">
                    <span className={clsx(
                      'rounded px-1.5 py-0.5 font-mono text-[10px]',
                      r.priority === 'URGENT' && 'bg-rose-100 text-rose-700',
                      r.priority === 'HIGH'   && 'bg-amber-100 text-amber-700',
                      r.priority === 'NORMAL' && 'bg-slate-100 text-slate-700',
                      r.priority === 'LOW'    && 'bg-slate-50 text-slate-500',
                    )}>{r.priority}</span>
                    {r.dueAt && (
                      <span className={overdue ? 'text-rose-600 font-semibold' : ''}>
                        Due {new Date(r.dueAt).toLocaleDateString()}{overdue && ' (overdue)'}
                      </span>
                    )}
                    <span className="flex items-center gap-1">
                      <UsersIcon size={11}/>{r.assignedTo?.fullName ?? 'Everyone'}
                    </span>
                    <span className="text-ink-400">
                      · by {r.createdBy?.fullName ?? '—'}
                    </span>
                    {done && r.completedBy && (
                      <span className="text-emerald-600">
                        <Check size={11} className="inline"/>Done by {r.completedBy.fullName}
                      </span>
                    )}
                  </div>
                </div>
                <div className="flex items-center gap-1">
                  <button className="btn-ghost" onClick={() => { setEditing(r); setShowForm(true); setForm({
                    title: r.title, notes: r.notes ?? '',
                    dueAt: r.dueAt ? r.dueAt.slice(0, 10) : '',
                    priority: r.priority, assignedToId: r.assignedToId ?? '',
                  }); }}>Edit</button>
                  <button className="btn-ghost text-rose-500"
                    onClick={() => { if (confirm('Delete this reminder?')) remove.mutate(r.id); }}>
                    <Trash2 size={12}/>
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      </section>
    </>
  );
}
