import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { PageHeader } from '@/components/PageHeader';

export function Warranties() {
  const [days, setDays] = useState(90);
  const dash = useQuery({ queryKey: ['warranty-dash'], queryFn: () => api.get('/warranties/dashboard').then((r) => r.data) });
  const list = useQuery({
    queryKey: ['warranty-list', days],
    queryFn: () => api.get('/warranties/expiring', { params: { in: days } }).then((r) => r.data),
  });

  const tiles = [
    { label: 'Expiring in 30 days', value: dash.data?.expiring30 ?? '—', tone: 'bg-rose-600' },
    { label: 'Expiring in 60 days', value: dash.data?.expiring60 ?? '—', tone: 'bg-amber-500' },
    { label: 'Expiring in 90 days', value: dash.data?.expiring90 ?? '—', tone: 'bg-gold-500' },
    { label: 'Already expired',     value: dash.data?.alreadyExpired ?? '—', tone: 'bg-slate-700' },
  ];

  return (
    <>
      <PageHeader title="Warranties" subtitle="Track warranty expiry across the asset estate" />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
        {tiles.map((t) => (
          <div key={t.label} className="card p-4">
            <div className={`mb-2 h-2 w-12 rounded-full ${t.tone}`} />
            <div className="text-xs uppercase text-slate-500">{t.label}</div>
            <div className="text-2xl font-semibold">{t.value}</div>
          </div>
        ))}
      </div>

      <div className="mt-6 flex items-center gap-2">
        <span className="text-sm text-slate-600">Window (days):</span>
        {[30, 60, 90, 180].map((d) => (
          <button key={d} onClick={() => setDays(d)}
            className={`btn ${days === d ? 'bg-brand-700 text-white' : 'btn-ghost'}`}>{d}</button>
        ))}
      </div>

      <div className="card mt-3 overflow-hidden">
        <table className="w-full">
          <thead className="bg-slate-50">
            <tr>
              <th className="th">Tag</th><th className="th">Model</th><th className="th">Supplier</th>
              <th className="th">Location</th><th className="th">Expires</th>
            </tr>
          </thead>
          <tbody>
            {list.data?.map((a: any) => (
              <tr key={a.id} className="border-t">
                <td className="td font-mono">{a.assetTag}</td>
                <td className="td">{a.sku?.manufacturer} {a.sku?.model}</td>
                <td className="td">{a.supplier?.name ?? '—'}</td>
                <td className="td">{a.assignedStore?.name ?? a.location?.name ?? '—'}</td>
                <td className="td">{a.warrantyExpiry ? new Date(a.warrantyExpiry).toLocaleDateString() : '—'}</td>
              </tr>
            ))}
            {(!list.data || list.data.length === 0) && (
              <tr><td className="td" colSpan={5}>No warranties expiring in the next {days} days.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
