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
        </>
      )}
    </>
  );
}
