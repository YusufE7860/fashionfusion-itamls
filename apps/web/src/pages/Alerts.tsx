import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { useAuth } from '@/store/auth';
import { PageHeader } from '@/components/PageHeader';
import { AlertTriangle, Info, OctagonAlert, X, RefreshCw } from 'lucide-react';
import clsx from 'clsx';

function SeverityIcon({ s }: { s: string }) {
  if (s === 'ERROR') return <OctagonAlert size={16} className="text-rose-600" />;
  if (s === 'WARN')  return <AlertTriangle size={16} className="text-amber-500" />;
  return <Info size={16} className="text-sky-600" />;
}

export function Alerts() {
  const qc = useQueryClient();
  const hasPerm = useAuth((s) => s.hasPermission);
  const [filter, setFilter] = useState<string>('ALL');

  const list = useQuery({ queryKey: ['alerts'], queryFn: () => api.get('/alerts').then((r) => r.data) });
  const summary = useQuery({ queryKey: ['alerts-summary'], queryFn: () => api.get('/alerts/summary').then((r) => r.data) });

  const dismiss = useMutation({
    mutationFn: (id: string) => api.post(`/alerts/${id}/dismiss`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['alerts'] });
      qc.invalidateQueries({ queryKey: ['alerts-summary'] });
    },
  });

  const run = useMutation({
    mutationFn: () => api.post('/alerts/run').then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['alerts'] });
      qc.invalidateQueries({ queryKey: ['alerts-summary'] });
    },
  });

  const filtered = (list.data ?? []).filter((a: any) => filter === 'ALL' || a.severity === filter);

  return (
    <>
      <PageHeader
        title="Alerts"
        subtitle="Auto-generated nightly — warranties, low stock, missing equipment, repair delays"
        actions={hasPerm('users:manage') &&
          <button className="btn-primary" onClick={() => run.mutate()} disabled={run.isPending}>
            <RefreshCw size={14}/>{run.isPending ? 'Scanning…' : 'Run scan now'}
          </button>}
      />

      <div className="mb-4 grid grid-cols-4 gap-3">
        <div className="card p-3">
          <div className="text-xs uppercase text-slate-500">Active total</div>
          <div className="text-2xl font-semibold">{summary.data?.active ?? '—'}</div>
        </div>
        {(['ERROR', 'WARN', 'INFO'] as const).map((s) => (
          <button key={s}
                  onClick={() => setFilter(filter === s ? 'ALL' : s)}
                  className={clsx('card p-3 text-left', filter === s && 'ring-2 ring-brand-500')}>
            <div className="flex items-center justify-between">
              <div className="text-xs uppercase text-slate-500">{s}</div>
              <SeverityIcon s={s} />
            </div>
            <div className="text-2xl font-semibold">{summary.data?.bySeverity?.[s] ?? '—'}</div>
          </button>
        ))}
      </div>

      <div className="card overflow-hidden">
        <table className="w-full">
          <thead className="bg-slate-50">
            <tr>
              <th className="th">Severity</th><th className="th">Type</th>
              <th className="th">Message</th><th className="th">When</th><th className="th"></th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((a: any) => (
              <tr key={a.id} className="border-t">
                <td className="td"><SeverityIcon s={a.severity} /></td>
                <td className="td"><span className="pill-slate text-xs">{a.type.replaceAll('_',' ')}</span></td>
                <td className="td">{a.message}</td>
                <td className="td text-xs text-slate-500">{new Date(a.createdAt).toLocaleString()}</td>
                <td className="td">
                  <button className="btn-ghost" onClick={() => dismiss.mutate(a.id)}>
                    <X size={14}/>Dismiss
                  </button>
                </td>
              </tr>
            ))}
            {filtered.length === 0 && (
              <tr><td className="td" colSpan={5}>No active alerts. Nightly scan runs at 03:00 — or click <b>Run scan now</b>.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
