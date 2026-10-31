import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { PageHeader } from '@/components/PageHeader';
import { useAuth } from '@/store/auth';
import { Plus, Trash2, Save } from 'lucide-react';

/**
 * Business hours + holiday admin.
 *   - BusinessHours is a singleton row — one open/close per weekday + TZ.
 *   - Holidays are a date list; recurring holidays apply every year.
 * SLA policies with businessHoursOnly=true use both to decide which minutes
 * count toward response/resolve.
 */
const DAYS: Array<[string, string]> = [
  ['mon', 'Monday'],   ['tue', 'Tuesday'], ['wed', 'Wednesday'],
  ['thu', 'Thursday'], ['fri', 'Friday'],  ['sat', 'Saturday'], ['sun', 'Sunday'],
];

export function HelpdeskBusinessHours() {
  const qc = useQueryClient();
  const hasPerm = useAuth((s) => s.hasPermission);
  const canWrite = hasPerm('tickets:business-hours:manage');

  const bh = useQuery({ queryKey: ['bh'], queryFn: () => api.get('/helpdesk/business-hours').then((r) => r.data) });
  const hols = useQuery({ queryKey: ['holidays'], queryFn: () => api.get('/helpdesk/holidays').then((r) => r.data) });

  const [form, setForm] = useState<any>({});
  useEffect(() => { if (bh.data) setForm(bh.data); }, [bh.data]);

  const save = useMutation({
    mutationFn: (body: any) => api.patch('/helpdesk/business-hours', body).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['bh'] }),
  });
  const addH = useMutation({
    mutationFn: (body: any) => api.post('/helpdesk/holidays', body).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['holidays'] }),
  });
  const rmH = useMutation({
    mutationFn: (id: string) => api.delete(`/helpdesk/holidays/${id}`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['holidays'] }),
  });

  return (
    <>
      <PageHeader title="Helpdesk — business hours & holidays"
        subtitle="SLA timers count only during these windows (when the SLA policy has businessHoursOnly)" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="card p-4">
          <h3 className="mb-3 text-sm font-semibold text-slate-700">Business hours</h3>
          <div className="space-y-2">
            {DAYS.map(([key, label]) => (
              <div key={key} className="grid grid-cols-[90px_1fr_1fr] items-center gap-2">
                <div className="text-xs font-semibold">{label}</div>
                <input type="time" className="field text-xs"
                  value={form[`${key}Open`] ?? ''}
                  onChange={(e) => setForm({ ...form, [`${key}Open`]: e.target.value })}
                  disabled={!canWrite}/>
                <input type="time" className="field text-xs"
                  value={form[`${key}Close`] ?? ''}
                  onChange={(e) => setForm({ ...form, [`${key}Close`]: e.target.value })}
                  disabled={!canWrite}/>
              </div>
            ))}
            <div>
              <label className="label">Timezone</label>
              <input className="field text-xs" value={form.timezone ?? 'Africa/Johannesburg'}
                onChange={(e) => setForm({ ...form, timezone: e.target.value })}
                disabled={!canWrite}/>
            </div>
          </div>
          {canWrite && (
            <button className="btn-primary mt-3" onClick={() => save.mutate(form)} disabled={save.isPending}>
              <Save size={13}/>{save.isPending ? 'Saving…' : 'Save hours'}
            </button>
          )}
        </section>

        <section className="card p-4">
          <h3 className="mb-3 text-sm font-semibold text-slate-700">Holidays</h3>
          <ul className="mb-3 space-y-1 text-xs">
            {hols.data?.length === 0 && <li className="text-ink-300">No holidays configured.</li>}
            {hols.data?.map((h: any) => (
              <li key={h.id} className="flex items-center justify-between rounded border border-ink-500/10 p-2">
                <span>
                  {new Date(h.date).toLocaleDateString()} · <b>{h.name}</b>
                  {h.recurring && <span className="ml-2 rounded bg-slate-100 px-1 text-[10px]">recurring</span>}
                </span>
                {canWrite && (
                  <button className="btn-ghost text-rose-500" onClick={() => rmH.mutate(h.id)}>
                    <Trash2 size={11}/>
                  </button>
                )}
              </li>
            ))}
          </ul>
          {canWrite && (
            <button className="btn-ghost"
              onClick={() => {
                const date = prompt('Date (YYYY-MM-DD):'); if (!date) return;
                const name = prompt('Name:'); if (!name) return;
                const recurring = confirm('Recurring every year?');
                addH.mutate({ date, name, recurring });
              }}>
              <Plus size={13}/>Add holiday
            </button>
          )}
        </section>
      </div>
    </>
  );
}
