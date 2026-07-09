import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { PageHeader } from '@/components/PageHeader';
import clsx from 'clsx';

export function ActivityLog() {
  const [q, setQ] = useState('');
  const [method, setMethod] = useState<string>('');
  const rows = useQuery({
    queryKey: ['activity', q, method],
    queryFn: () => api.get('/activity', { params: { q: q || undefined, method: method || undefined } }).then((r) => r.data),
  });
  return (
    <>
      <PageHeader title="Activity Log" subtitle="Every change made through the system — actor, action, target, payload" />
      <div className="mb-3 flex gap-2">
        <input className="field max-w-sm" placeholder="Search path or payload" value={q} onChange={(e) => setQ(e.target.value)} />
        <select className="field max-w-[140px]" value={method} onChange={(e) => setMethod(e.target.value)}>
          <option value="">All methods</option><option>POST</option><option>PATCH</option><option>DELETE</option><option>PUT</option>
        </select>
      </div>
      <div className="card overflow-hidden">
        <table className="w-full">
          <thead><tr>
            <th className="th">When</th><th className="th">Actor</th>
            <th className="th">Method</th><th className="th">Path</th>
            <th className="th">Result</th><th className="th">Payload (truncated)</th>
          </tr></thead>
          <tbody>
            {rows.data?.map((r: any) => (
              <tr key={r.id} className="border-t border-ink-500/30">
                <td className="td text-xs">{new Date(r.occurredAt).toLocaleString()}</td>
                <td className="td">{r.actor?.fullName ?? <span className="text-ink-200">—</span>}</td>
                <td className="td">
                  <span className={clsx('pill', r.method === 'POST' && 'pill-green', r.method === 'PATCH' && 'pill-amber', r.method === 'DELETE' && 'pill-red', !['POST','PATCH','DELETE'].includes(r.method) && 'pill-slate')}>
                    {r.method}
                  </span>
                </td>
                <td className="td font-mono text-xs">{r.path}</td>
                <td className="td">
                  <span className={r.action === 'OK' ? 'pill-green' : 'pill-red'}>{r.action}</span>
                </td>
                <td className="td max-w-md truncate font-mono text-[11px] text-ink-200">{r.payload ?? '—'}</td>
              </tr>
            ))}
            {(!rows.data || rows.data.length === 0) && <tr><td className="td" colSpan={6}>No activity recorded.</td></tr>}
          </tbody>
        </table>
      </div>
    </>
  );
}
