import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { PageHeader } from '@/components/PageHeader';
import { Pill } from '@/components/Pill';
import { Plus, ChevronRight } from 'lucide-react';

export function TonerOrders() {
  const qc = useQueryClient();
  const list = useQuery({ queryKey: ['toner-orders'], queryFn: () => api.get('/toner/orders').then((r) => r.data) });

  const [showNew, setShowNew] = useState(false);
  const today = new Date();
  const [form, setForm] = useState({ year: today.getFullYear(), month: today.getMonth() + 1, notes: '' });
  const generate = useMutation({
    mutationFn: () => api.post('/toner/orders/generate', form).then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['toner-orders'] }); setShowNew(false); },
  });

  return (
    <>
      <PageHeader
        title="Toner Orders"
        subtitle="Monthly snapshots of the plan — dispatch and track per store"
        actions={<button className="btn-primary" onClick={() => setShowNew(!showNew)}>
          <Plus size={14}/>{showNew ? 'Cancel' : 'Generate monthly order'}
        </button>}
      />

      {showNew && (
        <div className="card mb-4 p-4">
          <h3 className="mb-3 text-sm font-semibold text-white">Generate from plan</h3>
          <div className="grid grid-cols-4 gap-3">
            <div><label className="label">Year</label>
              <input type="number" className="field" value={form.year} onChange={(e) => setForm({ ...form, year: +e.target.value })} /></div>
            <div><label className="label">Month</label>
              <select className="field" value={form.month} onChange={(e) => setForm({ ...form, month: +e.target.value })}>
                {['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'].map((m, i) =>
                  <option key={m} value={i + 1}>{m}</option>)}
              </select></div>
            <div className="col-span-2"><label className="label">Notes (optional)</label>
              <input className="field" value={form.notes} onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          </div>
          <button className="btn-primary mt-3" disabled={generate.isPending} onClick={() => generate.mutate()}>
            {generate.isPending ? 'Generating…' : 'Generate'}
          </button>
          <p className="mt-2 text-xs text-ink-200">
            One line per (store, toner type) where the plan for that month is greater than zero. Re-running for the same month returns the existing order.
          </p>
        </div>
      )}

      <div className="card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr>
              <th className="th">Code</th><th className="th">Period</th>
              <th className="th">Status</th><th className="th text-right">Lines</th>
              <th className="th">Notes</th><th></th>
            </tr>
          </thead>
          <tbody>
            {list.data?.map((o: any) => (
              <tr key={o.id} className="border-t border-ink-500/30">
                <td className="td font-mono">
                  <Link to={`/toner/orders/${o.id}`} className="text-brand-300 hover:underline">{o.code}</Link>
                </td>
                <td className="td">{o.period}</td>
                <td className="td"><Pill status={o.status} /></td>
                <td className="td text-right">{o._count?.lines ?? 0}</td>
                <td className="td max-w-xs truncate text-ink-200">{o.notes ?? '—'}</td>
                <td className="td text-right"><Link to={`/toner/orders/${o.id}`}><ChevronRight size={16} className="text-brand-300"/></Link></td>
              </tr>
            ))}
            {(!list.data || list.data.length === 0) && (
              <tr><td className="td" colSpan={6}>No orders yet. Generate one from the plan above.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
