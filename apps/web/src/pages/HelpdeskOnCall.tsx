import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { PageHeader } from '@/components/PageHeader';
import { useAuth } from '@/store/auth';
import { Plus, Trash2, Pencil, Save, X, Send } from 'lucide-react';

/**
 * On-call rota admin. IT lead picks which technicians cover which hours on
 * weekends, public holidays, or after-hours. Shifts broadcast to stores and
 * area managers every Friday 07:00 (or on-demand).
 */
export function HelpdeskOnCall() {
  const qc = useQueryClient();
  const hasPerm = useAuth((s) => s.hasPermission);
  const canWrite = hasPerm('tickets:assign');

  // Default: show from 24h ago to 60 days out so the admin sees recently-ended
  // shifts for context, plus the full planning window.
  const today = new Date().toISOString().slice(0, 10);
  const [from, setFrom] = useState(new Date(Date.now() - 24 * 3600_000).toISOString().slice(0, 10));
  const [to, setTo] = useState(new Date(Date.now() + 60 * 24 * 3600_000).toISOString().slice(0, 10));

  const shifts = useQuery({
    queryKey: ['oncall-shifts', from, to],
    queryFn: () => api.get('/oncall/shifts', { params: { from, to } }).then((r) => r.data as any[]),
  });
  const users = useQuery({
    queryKey: ['users-techs'],
    queryFn: () => api.get('/users').then((r) => r.data as any[]).catch(() => []),
  });
  const techs = useMemo(() => (users.data ?? []).filter((u: any) =>
    u.isActive && ['ADMINISTRATOR','IT_MANAGER','TECHNICIAN'].includes(u.role?.code)
  ), [users.data]);

  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<any | null>(null);
  const empty = { technicianId: '', startAt: '', endAt: '', scope: 'ALL', notes: '' };
  const [form, setForm] = useState<any>(empty);

  const save = useMutation({
    mutationFn: () => editing
      ? api.patch(`/oncall/shifts/${editing.id}`, form).then((r) => r.data)
      : api.post('/oncall/shifts', form).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['oncall-shifts'] });
      setShowForm(false); setEditing(null); setForm(empty);
    },
    onError: (e: any) => alert(e?.response?.data?.message ?? 'Save failed'),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/oncall/shifts/${id}`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['oncall-shifts'] }),
  });
  const broadcast = useMutation({
    mutationFn: () => api.post('/oncall/broadcast').then((r) => r.data),
    onSuccess: (data: any) => alert(`Rota emailed to ${data.sent} recipient(s) — ${data.shifts} shift(s) covered.`),
    onError: (e: any) => alert(e?.response?.data?.message ?? 'Broadcast failed'),
  });

  // Group shifts by local calendar day for an easy-to-scan list.
  const byDay = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const s of shifts.data ?? []) {
      const d = new Date(s.startAt).toISOString().slice(0, 10);
      (map.get(d) ?? map.set(d, []).get(d)!).push(s);
    }
    return [...map.entries()].sort(([a], [b]) => a.localeCompare(b));
  }, [shifts.data]);

  function openCreate() {
    const start = new Date();
    // Snap to next Saturday 08:00 as a sensible default
    const dow = start.getDay();
    start.setDate(start.getDate() + ((6 - dow + 7) % 7 || 7));
    start.setHours(8, 0, 0, 0);
    const end = new Date(start); end.setHours(17, 0, 0, 0);
    setForm({
      technicianId: techs[0]?.id ?? '',
      startAt: toLocalInput(start),
      endAt:   toLocalInput(end),
      scope: 'ALL', notes: '',
    });
    setEditing(null); setShowForm(true);
  }

  function openEdit(s: any) {
    setForm({
      technicianId: s.technicianId,
      startAt: toLocalInput(new Date(s.startAt)),
      endAt:   toLocalInput(new Date(s.endAt)),
      scope: s.scope, notes: s.notes ?? '',
    });
    setEditing(s); setShowForm(true);
  }

  return (
    <>
      <PageHeader
        title="On-call rota"
        subtitle="Who's working weekends, public holidays and after-hours. Broadcast to all stores + area managers."
        actions={canWrite && (
          <>
            <button className="btn-ghost" onClick={() => broadcast.mutate()} disabled={broadcast.isPending}>
              <Send size={13}/>Broadcast now
            </button>
            <button className="btn-primary" onClick={openCreate}>
              <Plus size={13}/>New shift
            </button>
          </>
        )}
      />

      <section className="card mb-4 p-3">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <label className="label">From</label>
            <input type="date" className="field" value={from} onChange={(e) => setFrom(e.target.value)}/>
          </div>
          <div>
            <label className="label">To</label>
            <input type="date" className="field" value={to} onChange={(e) => setTo(e.target.value)}/>
          </div>
        </div>
      </section>

      {showForm && (
        <section className="card mb-4 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-700">
              {editing ? 'Edit shift' : 'New shift'}
            </h3>
            <button className="btn-ghost" onClick={() => { setShowForm(false); setEditing(null); setForm(empty); }}>
              <X size={13}/>
            </button>
          </div>

          <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
            <div>
              <label className="label">Technician</label>
              <select className="field" value={form.technicianId}
                onChange={(e) => setForm({ ...form, technicianId: e.target.value })}>
                <option value="">— pick —</option>
                {techs.map((t: any) => (
                  <option key={t.id} value={t.id}>{t.fullName} ({t.role?.code?.replaceAll('_', ' ')})</option>
                ))}
              </select>
            </div>
            <div>
              <label className="label">Scope</label>
              <input className="field" value={form.scope}
                placeholder="ALL or R:KZN,R:GP or S:FFN0221"
                onChange={(e) => setForm({ ...form, scope: e.target.value })}/>
              <p className="mt-1 text-[11px] text-ink-300">
                <code>ALL</code> covers everyone. Use <code>R:&lt;region code&gt;</code> or <code>S:&lt;store code&gt;</code>,
                comma-separated, to target a subset.
              </p>
            </div>
            <div>
              <label className="label">Start</label>
              <input type="datetime-local" className="field" value={form.startAt}
                onChange={(e) => setForm({ ...form, startAt: e.target.value })}/>
            </div>
            <div>
              <label className="label">End</label>
              <input type="datetime-local" className="field" value={form.endAt}
                onChange={(e) => setForm({ ...form, endAt: e.target.value })}/>
            </div>
            <div className="md:col-span-2">
              <label className="label">Notes</label>
              <input className="field" value={form.notes}
                placeholder='e.g. "Emergency POS only — call 082 123 4567"'
                onChange={(e) => setForm({ ...form, notes: e.target.value })}/>
            </div>
          </div>

          <button className="btn-primary mt-4"
            disabled={!form.technicianId || !form.startAt || !form.endAt || save.isPending}
            onClick={() => save.mutate()}>
            <Save size={13}/>{editing ? 'Save changes' : 'Create shift'}
          </button>
        </section>
      )}

      {/* Rota list grouped by day */}
      <section className="space-y-4">
        {byDay.length === 0 && (
          <div className="card p-6 text-center text-xs text-ink-300">
            No shifts scheduled in this range.
          </div>
        )}
        {byDay.map(([day, list]) => (
          <section key={day} className="card p-0">
            <header className="border-b border-ink-500/10 bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-ink-300">
              {new Date(day).toLocaleDateString('en-ZA',
                { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' })}
            </header>
            <ul className="divide-y divide-ink-500/10">
              {list.map((s: any) => (
                <li key={s.id} className="flex flex-wrap items-center gap-3 px-4 py-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold text-ink-50">
                      {s.technician.fullName}
                      <span className="ml-2 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px]">{s.scope}</span>
                      {!s.broadcastAt && (
                        <span className="ml-2 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] text-amber-700">
                          not broadcast
                        </span>
                      )}
                    </div>
                    <div className="text-xs text-ink-300">
                      {new Date(s.startAt).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })}
                      {' – '}
                      {new Date(s.endAt).toLocaleTimeString('en-ZA', { hour: '2-digit', minute: '2-digit' })}
                      {s.notes && <> · <i>{s.notes}</i></>}
                    </div>
                  </div>
                  {canWrite && (
                    <div className="flex gap-1">
                      <button className="btn-ghost" onClick={() => openEdit(s)}><Pencil size={11}/></button>
                      <button className="btn-ghost text-rose-500"
                        onClick={() => { if (confirm('Delete this shift?')) remove.mutate(s.id); }}>
                        <Trash2 size={11}/>
                      </button>
                    </div>
                  )}
                </li>
              ))}
            </ul>
          </section>
        ))}
      </section>
    </>
  );
}

/** Format a Date for a <input type="datetime-local"> value (no timezone). */
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
