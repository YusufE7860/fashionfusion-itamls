import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { PageHeader } from '@/components/PageHeader';
import { useAuth } from '@/store/auth';
import { Download, FileSpreadsheet, FileText, Plus, Trash2, Clock, Mail } from 'lucide-react';

/**
 * Helpdesk exports — browse the available report templates, pick a date
 * range, and download as XLSX or PDF. Also manages scheduled recurring
 * reports that email the file to a list of recipients.
 */
export function HelpdeskExports() {
  const qc = useQueryClient();
  const hasPerm = useAuth((s) => s.hasPermission);
  const canExport  = hasPerm('reports:export');
  const canSchedule = hasPerm('reports:export');

  const reports = useQuery({
    queryKey: ['hd-report-list'],
    queryFn: () => api.get('/helpdesk/exports/reports').then((r) => r.data),
  });
  const scheduled = useQuery({
    queryKey: ['hd-scheduled'],
    queryFn: () => api.get('/helpdesk/exports/scheduled').then((r) => r.data),
  });

  const today = new Date().toISOString().slice(0, 10);
  const monthAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10);
  const [since, setSince] = useState(monthAgo);
  const [until, setUntil] = useState(today);

  function download(reportKey: string, format: 'XLSX' | 'PDF') {
    const url = `${api.defaults.baseURL}/helpdesk/exports/download?reportKey=${encodeURIComponent(reportKey)}&format=${format}&since=${since}&until=${until}`;
    const token = localStorage.getItem('itamls-token') ?? '';
    // Use fetch so we can send the auth header, then open the blob
    fetch(url, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => {
        if (!r.ok) throw new Error(`Server returned ${r.status}`);
        return r.blob();
      })
      .then((b) => {
        const u = URL.createObjectURL(b);
        const a = document.createElement('a');
        const ext = format === 'PDF' ? 'pdf' : 'xlsx';
        a.href = u; a.download = `${reportKey}-${today}.${ext}`; a.click();
        URL.revokeObjectURL(u);
      })
      .catch((e) => alert(`Download failed: ${e.message}`));
  }

  const createSched = useMutation({
    mutationFn: (body: any) => api.post('/helpdesk/exports/scheduled', body).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hd-scheduled'] }),
    onError: (e: any) => alert(e?.response?.data?.message ?? 'Could not create schedule'),
  });
  const deleteSched = useMutation({
    mutationFn: (id: string) => api.delete(`/helpdesk/exports/scheduled/${id}`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hd-scheduled'] }),
  });

  function addSchedule(reportKey: string) {
    const name = prompt(`Give this schedule a name:`, reportKey);
    if (!name?.trim()) return;
    const cron = prompt(`Cron expression (minute hour day-of-month month day-of-week).\n\nExamples:\n  0 7 * * 1   → every Monday 07:00\n  0 8 * * *   → every day 08:00\n  0 6 1 * *   → 1st of every month 06:00`, '0 7 * * 1');
    if (!cron?.trim()) return;
    const recipients = prompt(`Recipient email(s), comma-separated:`);
    if (!recipients?.trim()) return;
    const format = (prompt(`Format (XLSX or PDF):`, 'XLSX')?.toUpperCase() ?? 'XLSX') === 'PDF' ? 'PDF' : 'XLSX';
    createSched.mutate({ name, reportKey, cronExpression: cron.trim(), recipients: recipients.trim(), format });
  }

  // Group reports by `group` key
  const grouped: Record<string, any[]> = {};
  (reports.data ?? []).forEach((r: any) => {
    (grouped[r.group ?? 'Reports'] ??= []).push(r);
  });

  return (
    <>
      <PageHeader
        title="Helpdesk — reports & exports"
        subtitle="Download pre-built reports as Excel or PDF. Schedule recurring reports to be emailed to a list."
      />

      {/* Date range */}
      <section className="card mb-4 p-4">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <label className="label">From</label>
            <input type="date" className="field" value={since} onChange={(e) => setSince(e.target.value)}/>
          </div>
          <div>
            <label className="label">To</label>
            <input type="date" className="field" value={until} onChange={(e) => setUntil(e.target.value)}/>
          </div>
          <div className="flex flex-wrap items-end gap-2">
            {[
              { label: 'Last 7 days', days: 7 },
              { label: 'Last 30 days', days: 30 },
              { label: 'Last 90 days', days: 90 },
              { label: 'Year to date', days: null },
            ].map((p) => (
              <button key={p.label} className="btn-ghost text-xs"
                onClick={() => {
                  const now = new Date();
                  if (p.days == null) setSince(`${now.getFullYear()}-01-01`);
                  else setSince(new Date(Date.now() - p.days * 86400_000).toISOString().slice(0, 10));
                  setUntil(today);
                }}>
                {p.label}
              </button>
            ))}
          </div>
        </div>
      </section>

      {/* Report templates grouped */}
      {Object.entries(grouped).map(([group, items]) => (
        <section key={group} className="card mb-4 p-0">
          <header className="border-b border-ink-500/10 bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-ink-300">
            {group}
          </header>
          <ul className="divide-y divide-ink-500/10">
            {items.map((r) => (
              <li key={r.key} className="flex flex-wrap items-center gap-3 px-4 py-3">
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-medium text-ink-50">{r.label}</div>
                  <div className="font-mono text-[11px] text-ink-300">{r.key}</div>
                </div>
                {canExport && (
                  <div className="flex gap-1">
                    <button className="btn-ghost text-xs"
                      onClick={() => download(r.key, 'XLSX')} title="Download as Excel">
                      <FileSpreadsheet size={13}/>XLSX
                    </button>
                    <button className="btn-ghost text-xs"
                      onClick={() => download(r.key, 'PDF')} title="Download as PDF">
                      <FileText size={13}/>PDF
                    </button>
                    {canSchedule && (
                      <button className="btn-ghost text-xs" title="Email on a schedule"
                        onClick={() => addSchedule(r.key)}>
                        <Clock size={13}/>Schedule
                      </button>
                    )}
                  </div>
                )}
              </li>
            ))}
          </ul>
        </section>
      ))}

      {/* Scheduled list */}
      <section className="card p-0">
        <header className="border-b border-ink-500/10 bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-wider text-ink-300">
          Scheduled reports
        </header>
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="th text-left">Name</th>
              <th className="th text-left">Report</th>
              <th className="th text-left">Cron</th>
              <th className="th text-left">Format</th>
              <th className="th text-left">Recipients</th>
              <th className="th text-left">Next run</th>
              <th className="th text-left">Last run</th>
              <th className="th text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {scheduled.data?.length === 0 && (
              <tr><td colSpan={8} className="py-6 text-center text-xs text-ink-300">
                None yet. Click <b>Schedule</b> next to any report above to add one.
              </td></tr>
            )}
            {scheduled.data?.map((s: any) => (
              <tr key={s.id} className="border-t border-ink-500/10">
                <td className="py-2 pl-3 font-medium">{s.name}</td>
                <td className="py-2 font-mono text-[11px]">{s.reportKey}</td>
                <td className="py-2 font-mono text-[11px]">{s.cronExpression}</td>
                <td className="py-2">{s.format}</td>
                <td className="py-2 text-xs">{s.recipients}</td>
                <td className="py-2 text-xs text-ink-300">
                  {s.nextRunAt ? new Date(s.nextRunAt).toLocaleString() : '—'}
                </td>
                <td className="py-2 text-xs text-ink-300">
                  {s.lastRunAt ? new Date(s.lastRunAt).toLocaleString() : '—'}
                  {s.lastError && <div className="text-[10px] text-rose-500">⚠ {s.lastError}</div>}
                </td>
                <td className="py-2 pr-3 text-right">
                  {canSchedule && (
                    <button className="btn-ghost text-rose-500"
                      onClick={() => { if (confirm(`Delete "${s.name}"?`)) deleteSched.mutate(s.id); }}>
                      <Trash2 size={12}/>
                    </button>
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
