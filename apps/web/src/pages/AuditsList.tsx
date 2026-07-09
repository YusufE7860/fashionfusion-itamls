import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { PageHeader } from '@/components/PageHeader';
import { Pill } from '@/components/Pill';

export function AuditsList() {
  const qc = useQueryClient();
  const audits = useQuery({ queryKey: ['audits'], queryFn: () => api.get('/audits').then((r) => r.data) });
  const stores = useQuery({ queryKey: ['stores'], queryFn: () => api.get('/stores').then((r) => r.data) });
  const [storeId, setStoreId] = useState('');

  const create = useMutation({
    mutationFn: () => api.post('/audits', { storeId }).then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['audits'] }); setStoreId(''); },
  });

  return (
    <>
      <PageHeader title="Store Audits" subtitle="Schedule and run on-site asset audits" />
      <div className="card mb-4 p-4">
        <div className="flex items-end gap-3">
          <div className="flex-1">
            <label className="label">Schedule audit for store</label>
            <select className="field" value={storeId} onChange={(e) => setStoreId(e.target.value)}>
              <option value="">Pick a store…</option>
              {stores.data?.map((s: any) => <option key={s.id} value={s.id}>{s.code} – {s.name}</option>)}
            </select>
          </div>
          <button className="btn-primary" disabled={!storeId || create.isPending} onClick={() => create.mutate()}>
            {create.isPending ? 'Creating…' : 'Create audit'}
          </button>
        </div>
      </div>

      <div className="card overflow-hidden">
        <table className="w-full">
          <thead className="bg-slate-50">
            <tr>
              <th className="th">Code</th><th className="th">Store</th>
              <th className="th">Scheduled</th><th className="th">Status</th>
              <th className="th text-right">Lines</th>
            </tr>
          </thead>
          <tbody>
            {audits.data?.map((a: any) => (
              <tr key={a.id} className="border-t">
                <td className="td font-mono">
                  <Link to={`/audits/${a.id}`} className="text-brand-700 underline">{a.code}</Link>
                </td>
                <td className="td">{a.store?.code} – {a.store?.name}</td>
                <td className="td">{new Date(a.scheduledFor).toLocaleDateString()}</td>
                <td className="td"><Pill status={a.status} /></td>
                <td className="td text-right">{a.lines?.length}</td>
              </tr>
            ))}
            {(!audits.data || audits.data.length === 0) && (
              <tr><td className="td" colSpan={5}>No audits scheduled.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
