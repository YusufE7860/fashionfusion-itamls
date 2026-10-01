import { useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { PageHeader } from '@/components/PageHeader';
import { useAuth } from '@/store/auth';
import { AlertTriangle, Filter, Plus, RefreshCw, Search } from 'lucide-react';

const STATUSES = ['NEW','ASSIGNED','IN_PROGRESS','WAITING_ON_USER','RESOLVED','CLOSED','REOPENED'] as const;
const PRIORITIES = ['P1','P2','P3','P4'] as const;

const PRIORITY_STYLES: Record<string, string> = {
  P1: 'bg-rose-100 text-rose-700 ring-1 ring-rose-300',
  P2: 'bg-amber-100 text-amber-700 ring-1 ring-amber-300',
  P3: 'bg-sky-100 text-sky-700 ring-1 ring-sky-300',
  P4: 'bg-slate-100 text-slate-600 ring-1 ring-slate-300',
};
const STATUS_STYLES: Record<string, string> = {
  NEW: 'bg-brand-50 text-brand-700 ring-1 ring-brand-200',
  ASSIGNED: 'bg-sky-50 text-sky-700 ring-1 ring-sky-200',
  IN_PROGRESS: 'bg-violet-50 text-violet-700 ring-1 ring-violet-200',
  WAITING_ON_USER: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  RESOLVED: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  CLOSED: 'bg-slate-100 text-slate-500 ring-1 ring-slate-300',
  REOPENED: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200',
};

export function HelpdeskQueue() {
  const nav = useNavigate();
  const hasPerm = useAuth((s) => s.hasPermission);
  const canWrite = hasPerm('tickets:write');
  const canAssign = hasPerm('tickets:assign');

  const [openOnly, setOpenOnly] = useState(true);
  const [status, setStatus] = useState<string[]>([]);
  const [priority, setPriority] = useState<string[]>([]);
  const [storeId, setStoreId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [assignedToId, setAssignedToId] = useState('');
  const [q, setQ] = useState('');

  const stores      = useQuery({ queryKey: ['stores'],     queryFn: () => api.get('/stores').then((r) => r.data) });
  const categories  = useQuery({ queryKey: ['hd-cats'],    queryFn: () => api.get('/helpdesk/categories').then((r) => r.data) });
  const users       = useQuery({ queryKey: ['hd-users'],   queryFn: () => api.get('/users').then((r) => r.data).catch(() => []) });

  const params = useMemo(() => {
    const p: any = {};
    if (openOnly) p.openOnly = 'true';
    if (status.length)   p.status   = status.join(',');
    if (priority.length) p.priority = priority.join(',');
    if (storeId)         p.storeId  = storeId;
    if (categoryId)      p.categoryId = categoryId;
    if (assignedToId)    p.assignedToId = assignedToId;
    if (q.trim())        p.q = q.trim();
    return p;
  }, [openOnly, status, priority, storeId, categoryId, assignedToId, q]);

  const tickets = useQuery({
    queryKey: ['hd-queue', params],
    queryFn: () => api.get('/helpdesk/tickets', { params }).then((r) => r.data),
    refetchInterval: 30_000,
  });

  const toggle = (list: string[], setList: (l: string[]) => void, v: string) =>
    setList(list.includes(v) ? list.filter((x) => x !== v) : [...list, v]);

  return (
    <>
      <PageHeader
        title="Helpdesk Queue"
        subtitle="Every ticket you can see, oldest by priority first"
        actions={
          <>
            <button className="btn-ghost" onClick={() => tickets.refetch()}><RefreshCw size={13} />Refresh</button>
            {canWrite && (
              <button className="btn-primary" onClick={() => nav('/helpdesk/new')}>
                <Plus size={13} />New ticket
              </button>
            )}
          </>
        }
      />

      {/* Filters */}
      <section className="card mb-4 p-3">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-ink-300">
          <Filter size={12}/>Filters
          <label className="ml-auto flex items-center gap-1 text-xs font-normal text-ink-200">
            <input type="checkbox" checked={openOnly} onChange={(e) => setOpenOnly(e.target.checked)} />
            Open only
          </label>
        </div>

        <div className="mb-2 flex flex-wrap gap-1.5">
          {STATUSES.map((s) => (
            <button key={s}
              className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${
                status.includes(s) ? STATUS_STYLES[s] : 'border-ink-500 bg-white text-ink-200 hover:border-brand-400'
              }`}
              onClick={() => toggle(status, setStatus, s)}>
              {s.replaceAll('_', ' ')}
            </button>
          ))}
        </div>
        <div className="mb-2 flex flex-wrap gap-1.5">
          {PRIORITIES.map((p) => (
            <button key={p}
              className={`rounded-full border px-2.5 py-0.5 text-[11px] font-medium ${
                priority.includes(p) ? PRIORITY_STYLES[p] : 'border-ink-500 bg-white text-ink-200 hover:border-brand-400'
              }`}
              onClick={() => toggle(priority, setPriority, p)}>
              {p}
            </button>
          ))}
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <div>
            <label className="label">Store</label>
            <select className="field" value={storeId} onChange={(e) => setStoreId(e.target.value)}>
              <option value="">All</option>
              {stores.data?.map((s: any) => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Category</label>
            <select className="field" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">All</option>
              {categories.data?.map((c: any) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
            </select>
          </div>
          {canAssign && (
            <div>
              <label className="label">Assignee</label>
              <select className="field" value={assignedToId} onChange={(e) => setAssignedToId(e.target.value)}>
                <option value="">Anyone</option>
                <option value="unassigned">Unassigned</option>
                {users.data?.map((u: any) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="label">Search</label>
            <div className="relative">
              <Search size={13} className="absolute left-2 top-2.5 text-ink-300" />
              <input className="field pl-7" placeholder="code / subject / description"
                value={q} onChange={(e) => setQ(e.target.value)} />
            </div>
          </div>
        </div>
      </section>

      {/* Table */}
      <section className="card p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="th text-left">Code</th>
                <th className="th text-left">Subject</th>
                <th className="th text-left">Priority</th>
                <th className="th text-left">Status</th>
                <th className="th text-left">Category</th>
                <th className="th text-left">Store</th>
                <th className="th text-left">Assignee</th>
                <th className="th text-left">Reporter</th>
                <th className="th text-left">Opened</th>
              </tr>
            </thead>
            <tbody>
              {tickets.data?.items?.map((t: any) => (
                <tr key={t.id} className="border-b border-ink-500/10 hover:bg-slate-50">
                  <td className="py-2 pl-3 font-mono text-xs">
                    <Link className="text-brand-700 hover:underline" to={`/helpdesk/tickets/${t.id}`}>{t.code}</Link>
                  </td>
                  <td className="py-2 pr-3">
                    <div className="flex items-center gap-2">
                      <span className="max-w-[420px] truncate">{t.subject}</span>
                      {(t.slaBreachedResponse || t.slaBreachedResolve) && (
                        <span title="SLA breached"><AlertTriangle size={12} className="text-rose-500" /></span>
                      )}
                      {t._count?.comments > 0 && (
                        <span className="text-[11px] text-ink-300">💬 {t._count.comments}</span>
                      )}
                    </div>
                  </td>
                  <td className="py-2"><span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${PRIORITY_STYLES[t.priority]}`}>{t.priority}</span></td>
                  <td className="py-2"><span className={`rounded px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[t.status]}`}>{t.status.replaceAll('_',' ')}</span></td>
                  <td className="py-2 text-xs">{t.category?.name ?? '—'}</td>
                  <td className="py-2 text-xs">{t.store ? `${t.store.code}` : '—'}</td>
                  <td className="py-2 text-xs">{t.assignedTo?.fullName ?? <span className="italic text-ink-300">Unassigned</span>}</td>
                  <td className="py-2 text-xs">{t.reporter?.fullName ?? '—'}</td>
                  <td className="py-2 pr-3 text-xs text-ink-300">{new Date(t.createdAt).toLocaleString()}</td>
                </tr>
              ))}
              {(!tickets.data?.items || tickets.data.items.length === 0) && (
                <tr><td colSpan={9} className="py-6 text-center text-xs text-ink-300">No tickets match these filters.</td></tr>
              )}
            </tbody>
          </table>
        </div>
        {tickets.data && (
          <div className="border-t border-ink-500/20 px-3 py-2 text-[11px] text-ink-300">
            Showing {tickets.data.items.length} of {tickets.data.total}
          </div>
        )}
      </section>
    </>
  );
}
