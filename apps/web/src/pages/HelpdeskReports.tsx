import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Bar, BarChart, CartesianGrid, Cell, Legend, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { api } from '@/api/client';
import { PageHeader } from '@/components/PageHeader';
import { useAuth } from '@/store/auth';
import { Download, RefreshCw } from 'lucide-react';

const PRIORITY_COLORS: Record<string, string> = {
  P1: '#e11d48', P2: '#f59e0b', P3: '#0ea5e9', P4: '#94a3b8',
};
const STATUS_COLORS: Record<string, string> = {
  NEW: '#f97316', ASSIGNED: '#0ea5e9', IN_PROGRESS: '#7c3aed',
  WAITING_ON_USER: '#f59e0b', RESOLVED: '#10b981', CLOSED: '#64748b', REOPENED: '#e11d48',
};

export function HelpdeskReports() {
  const token = useAuth((s) => s.token);
  const today = new Date();
  const startDefault = new Date(today.getTime() - 30 * 86400_000);
  const [from, setFrom] = useState(startDefault.toISOString().slice(0, 10));
  const [to,   setTo]   = useState(today.toISOString().slice(0, 10));

  const rep = useQuery({
    queryKey: ['hd-reports', from, to],
    queryFn: () => api.get('/helpdesk/reports', { params: { from, to } }).then((r) => r.data),
  });

  function downloadCsv() {
    const params = new URLSearchParams({ from, to });
    fetch(`${api.defaults.baseURL}/helpdesk/reports/export.csv?${params.toString()}`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.blob())
      .then((b) => {
        const url = URL.createObjectURL(b);
        const a = document.createElement('a');
        a.href = url; a.download = `helpdesk-report-${to}.csv`; a.click();
      });
  }

  const r = rep.data;
  const trendData = useMemo(() => r?.trend ?? [], [r]);

  return (
    <>
      <PageHeader
        title="Helpdesk reports"
        subtitle="How your ticket queue is performing"
        actions={
          <>
            <button className="btn-ghost" onClick={() => rep.refetch()}><RefreshCw size={13}/>Refresh</button>
            <button className="btn-primary" onClick={downloadCsv}><Download size={13}/>Export CSV</button>
          </>
        }
      />

      <section className="card mb-4 p-3">
        <div className="flex flex-wrap items-end gap-3">
          <div>
            <label className="label">From</label>
            <input type="date" className="field" value={from} onChange={(e) => setFrom(e.target.value)} />
          </div>
          <div>
            <label className="label">To</label>
            <input type="date" className="field" value={to} onChange={(e) => setTo(e.target.value)} />
          </div>
          <div className="ml-auto text-xs text-ink-300">
            {r && <>Range: <b>{r.totals?.inRange}</b> tickets logged · <b>{r.totals?.openNow}</b> currently open</>}
          </div>
        </div>
      </section>

      {r && (
        <>
          {/* KPI cards */}
          <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
            <div className="card p-3">
              <div className="text-[11px] uppercase tracking-wider text-ink-300">Total in range</div>
              <div className="text-2xl font-bold text-ink-50">{r.totals.inRange}</div>
            </div>
            <div className="card p-3">
              <div className="text-[11px] uppercase tracking-wider text-ink-300">Currently open</div>
              <div className="text-2xl font-bold text-ink-50">{r.totals.openNow}</div>
            </div>
            <div className="card p-3">
              <div className="text-[11px] uppercase tracking-wider text-ink-300">Response SLA</div>
              <div className="text-2xl font-bold text-ink-50">{r.sla.responsePercent}%</div>
              <div className="text-[11px] text-ink-300">Tickets meeting first-response SLA</div>
            </div>
            <div className="card p-3">
              <div className="text-[11px] uppercase tracking-wider text-ink-300">Resolve SLA</div>
              <div className="text-2xl font-bold text-ink-50">{r.sla.resolvePercent}%</div>
              <div className="text-[11px] text-ink-300">Tickets closed on time</div>
            </div>
          </div>

          {/* Charts row 1: status donut + priority bars */}
          <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            <section className="card p-4">
              <h3 className="mb-3 text-sm font-semibold text-slate-700">By status</h3>
              <ResponsiveContainer width="100%" height={220}>
                <PieChart>
                  <Pie data={r.byStatus} dataKey="count" nameKey="status" innerRadius={40} outerRadius={80}>
                    {r.byStatus.map((s: any) => <Cell key={s.status} fill={STATUS_COLORS[s.status] ?? '#888'} />)}
                  </Pie>
                  <Tooltip /><Legend />
                </PieChart>
              </ResponsiveContainer>
            </section>
            <section className="card p-4">
              <h3 className="mb-3 text-sm font-semibold text-slate-700">By priority</h3>
              <ResponsiveContainer width="100%" height={220}>
                <BarChart data={r.byPriority}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="priority" /><YAxis />
                  <Tooltip />
                  <Bar dataKey="count">
                    {r.byPriority.map((p: any) => <Cell key={p.priority} fill={PRIORITY_COLORS[p.priority] ?? '#888'} />)}
                  </Bar>
                </BarChart>
              </ResponsiveContainer>
            </section>
          </div>

          {/* Trend */}
          <section className="card mb-4 p-4">
            <h3 className="mb-3 text-sm font-semibold text-slate-700">Created vs resolved (daily)</h3>
            <ResponsiveContainer width="100%" height={260}>
              <LineChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" />
                <XAxis dataKey="date" />
                <YAxis />
                <Tooltip /><Legend />
                <Line type="monotone" dataKey="created"  stroke="#e11d48" strokeWidth={2} />
                <Line type="monotone" dataKey="resolved" stroke="#10b981" strokeWidth={2} />
              </LineChart>
            </ResponsiveContainer>
          </section>

          {/* Row: category + store */}
          <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            <section className="card p-4">
              <h3 className="mb-3 text-sm font-semibold text-slate-700">By category</h3>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={r.byCategory} layout="vertical" margin={{ left: 60 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" />
                  <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#0ea5e9" />
                </BarChart>
              </ResponsiveContainer>
            </section>
            <section className="card p-4">
              <h3 className="mb-3 text-sm font-semibold text-slate-700">Top 10 stores</h3>
              <ResponsiveContainer width="100%" height={280}>
                <BarChart data={r.byStore.slice(0, 10)} layout="vertical" margin={{ left: 80 }}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis type="number" />
                  <YAxis type="category" dataKey="name" width={160} tick={{ fontSize: 11 }} />
                  <Tooltip />
                  <Bar dataKey="count" fill="#f97316" />
                </BarChart>
              </ResponsiveContainer>
            </section>
          </div>

          {/* MTTR + Assignee */}
          <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-2">
            <section className="card p-4">
              <h3 className="mb-3 text-sm font-semibold text-slate-700">Mean time to resolve (minutes)</h3>
              <table className="w-full text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="th text-left">Priority</th>
                    <th className="th text-right">MTTFR</th>
                    <th className="th text-right">MTTR</th>
                    <th className="th text-right">Resolved</th>
                  </tr>
                </thead>
                <tbody>
                  {['P1','P2','P3','P4'].map((p) => (
                    <tr key={p} className="border-b border-ink-500/10">
                      <td className="py-2 font-mono">{p}</td>
                      <td className="py-2 text-right">{(r.mttfrByPriority as any)[p]?.avg ?? 0}</td>
                      <td className="py-2 text-right">{(r.mttrByPriority as any)[p]?.avg ?? 0}</td>
                      <td className="py-2 text-right text-ink-300">{(r.mttrByPriority as any)[p]?.count ?? 0}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
            <section className="card p-4">
              <h3 className="mb-3 text-sm font-semibold text-slate-700">By assignee</h3>
              <table className="w-full text-sm">
                <thead className="bg-slate-50">
                  <tr><th className="th text-left">Assignee</th><th className="th text-right">Tickets</th></tr>
                </thead>
                <tbody>
                  {r.byAssignee.slice(0, 15).map((a: any) => (
                    <tr key={a.userId ?? 'unassigned'} className="border-b border-ink-500/10">
                      <td className="py-2 text-xs">{a.name}</td>
                      <td className="py-2 text-right">{a.count}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          </div>

          {/* Technician scorecard */}
          {r.technicians && r.technicians.length > 0 && (
            <section className="card mb-4 p-4">
              <h3 className="mb-3 text-sm font-semibold text-slate-700">Technician scorecard</h3>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="th text-left">Technician</th>
                      <th className="th text-right">Total</th>
                      <th className="th text-right">Open now</th>
                      <th className="th text-right">Resolved</th>
                      <th className="th text-right">MTTR (min)</th>
                      <th className="th text-right">SLA %</th>
                      <th className="th text-right">★ avg</th>
                      <th className="th text-right">Ratings</th>
                    </tr>
                  </thead>
                  <tbody>
                    {r.technicians.map((t: any) => (
                      <tr key={t.userId} className="border-b border-ink-500/10">
                        <td className="py-2">{t.name}</td>
                        <td className="py-2 text-right">{t.total}</td>
                        <td className="py-2 text-right">{t.openNow}</td>
                        <td className="py-2 text-right">{t.resolved}</td>
                        <td className="py-2 text-right">{t.mttrMinutes}</td>
                        <td className="py-2 text-right">
                          <span className={t.slaPercent >= 90 ? 'text-emerald-600' : t.slaPercent >= 75 ? 'text-amber-600' : 'text-rose-600'}>
                            {t.slaPercent}%
                          </span>
                        </td>
                        <td className="py-2 text-right">{t.avgSatisfaction ? t.avgSatisfaction.toFixed(1) : '—'}</td>
                        <td className="py-2 text-right text-ink-300">{t.ratedCount}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </section>
          )}

          {/* Common issues + satisfaction + reopens */}
          <div className="mb-4 grid grid-cols-1 gap-4 md:grid-cols-3">
            {r.commonIssues && r.commonIssues.length > 0 && (
              <section className="card p-4 md:col-span-2">
                <h3 className="mb-3 text-sm font-semibold text-slate-700">Most common issue terms</h3>
                <ResponsiveContainer width="100%" height={280}>
                  <BarChart data={r.commonIssues.slice(0, 15)} layout="vertical" margin={{ left: 80 }}>
                    <CartesianGrid strokeDasharray="3 3" />
                    <XAxis type="number" />
                    <YAxis type="category" dataKey="term" width={120} tick={{ fontSize: 11 }} />
                    <Tooltip />
                    <Bar dataKey="count" fill="#7c3aed" />
                  </BarChart>
                </ResponsiveContainer>
                <p className="mt-2 text-[11px] text-ink-300">Terms extracted from ticket subjects after removing stopwords.</p>
              </section>
            )}

            {r.satisfaction && (
              <section className="card p-4">
                <h3 className="mb-3 text-sm font-semibold text-slate-700">Satisfaction</h3>
                <div className="mb-2 flex items-baseline gap-2">
                  <div className="text-3xl font-bold text-ink-50">
                    {r.satisfaction.average ? r.satisfaction.average.toFixed(1) : '—'}
                  </div>
                  <div className="text-xs text-ink-300">
                    / 5 · {r.satisfaction.totalRatings} rating{r.satisfaction.totalRatings === 1 ? '' : 's'}
                  </div>
                </div>
                <div className="space-y-1">
                  {[5,4,3,2,1].map((n) => {
                    const count = r.satisfaction.buckets?.[n] ?? 0;
                    const total = r.satisfaction.totalRatings || 1;
                    const pct = Math.round((count / total) * 100);
                    return (
                      <div key={n} className="flex items-center gap-2 text-xs">
                        <span className="w-6 text-amber-500">{'★'.repeat(n)}</span>
                        <div className="flex-1 h-2 rounded bg-slate-100 overflow-hidden">
                          <div className="h-full bg-amber-400" style={{ width: `${pct}%` }} />
                        </div>
                        <span className="w-10 text-right text-ink-300">{count}</span>
                      </div>
                    );
                  })}
                </div>
              </section>
            )}
          </div>

          {r.topReopens && r.topReopens.length > 0 && (
            <section className="card mb-4 p-4">
              <h3 className="mb-3 text-sm font-semibold text-slate-700">Most reopened tickets</h3>
              <table className="w-full text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="th text-left">Ticket</th>
                    <th className="th text-left">Subject</th>
                    <th className="th text-left">Store</th>
                    <th className="th text-right">Reopens</th>
                    <th className="th text-left">Status</th>
                  </tr>
                </thead>
                <tbody>
                  {r.topReopens.map((t: any) => (
                    <tr key={t.id} className="border-b border-ink-500/10">
                      <td className="py-2 font-mono text-xs">{t.code}</td>
                      <td className="py-2 text-xs">{t.subject}</td>
                      <td className="py-2 text-xs text-ink-300">{t.storeName ?? '—'}</td>
                      <td className="py-2 text-right">
                        <span className={t.reopenCount >= 3 ? 'font-bold text-rose-600' : ''}>{t.reopenCount}</span>
                      </td>
                      <td className="py-2 text-xs">{t.status}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </section>
          )}
        </>
      )}
    </>
  );
}
