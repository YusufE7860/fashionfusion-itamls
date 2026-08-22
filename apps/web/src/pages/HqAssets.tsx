import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '@/api/client';
import { PageHeader } from '@/components/PageHeader';
import { useAuth } from '@/store/auth';
import { formatZAR } from '@itamls/shared';
import { Building2, Search } from 'lucide-react';

type Dept = { id: string; code: string; name: string; sortOrder: number; isActive: boolean; _count?: { assets: number } };
type Asset = {
  id: string; assetTag: string; serialNo?: string; status: string;
  purchaseCostCents: number; currentValueCents: number;
  sku: { name: string; model: string; category: { name: string } };
  assignedDepartment?: Dept;
  location?: { name: string; type: string };
};

export function HqAssets() {
  const qc = useQueryClient();
  const hasPerm = useAuth((s) => s.hasPermission);
  const canMove = hasPerm('assets:move');

  const depts = useQuery({ queryKey: ['departments'], queryFn: () => api.get<Dept[]>('/departments').then((r) => r.data) });
  const [deptFilter, setDeptFilter] = useState('');
  const [q, setQ] = useState('');

  const assets = useQuery({
    queryKey: ['hq-assets', deptFilter, q],
    queryFn: () => api.get<Asset[]>('/assets', {
      params: { hqOnly: 'true', assignedDepartmentId: deptFilter || undefined, q: q || undefined },
    }).then((r) => r.data),
  });

  const assign = useMutation({
    mutationFn: ({ id, deptId }: { id: string; deptId: string | null }) =>
      api.post(`/assets/${id}/assign-department`, { departmentId: deptId }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hq-assets'] });
      qc.invalidateQueries({ queryKey: ['departments'] });
    },
  });

  // Group by department for the summary strip
  const byDept = useMemo(() => {
    const map = new Map<string, { name: string; count: number; totalCents: number }>();
    for (const d of depts.data ?? []) map.set(d.id, { name: d.name, count: 0, totalCents: 0 });
    map.set('__UNASSIGNED__', { name: 'Unassigned', count: 0, totalCents: 0 });
    for (const a of assets.data ?? []) {
      const key = a.assignedDepartment?.id ?? '__UNASSIGNED__';
      const row = map.get(key) ?? { name: '—', count: 0, totalCents: 0 };
      row.count += 1;
      row.totalCents += a.currentValueCents;
      map.set(key, row);
    }
    return map;
  }, [assets.data, depts.data]);

  return (
    <>
      <PageHeader
        title="HQ Assets"
        subtitle="Head Office assets grouped by department"
      />

      {/* Department strip */}
      <div className="mb-4 grid grid-cols-2 gap-2 md:grid-cols-5">
        <button
          onClick={() => setDeptFilter('')}
          className={`card p-3 text-left transition-all hover:border-brand-400 ${deptFilter === '' ? 'ring-2 ring-brand-400' : ''}`}>
          <div className="text-[11px] uppercase tracking-wider text-ink-300">All Departments</div>
          <div className="text-xl font-bold text-ink-50">{assets.data?.length ?? 0}</div>
        </button>
        {depts.data?.filter((d) => d.isActive).map((d) => {
          const stat = byDept.get(d.id) ?? { count: 0, totalCents: 0 };
          return (
            <button key={d.id}
              onClick={() => setDeptFilter(deptFilter === d.id ? '' : d.id)}
              className={`card p-3 text-left transition-all hover:border-brand-400 ${deptFilter === d.id ? 'ring-2 ring-brand-400' : ''}`}>
              <div className="text-[11px] uppercase tracking-wider text-ink-300">{d.name}</div>
              <div className="text-xl font-bold text-ink-50">{stat.count}</div>
              <div className="text-[10px] text-ink-300">{formatZAR(stat.totalCents)}</div>
            </button>
          );
        })}
      </div>

      <section className="card mb-4 p-3">
        <div className="relative">
          <Search size={13} className="absolute left-2 top-2.5 text-ink-300" />
          <input className="field pl-7" placeholder="Search tag / serial / SKU…" value={q} onChange={(e) => setQ(e.target.value)} />
        </div>
      </section>

      <section className="card p-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="th text-left">Tag</th>
                <th className="th text-left">Item</th>
                <th className="th text-left">Serial</th>
                <th className="th text-left">Department</th>
                <th className="th text-left">Status</th>
                <th className="th text-right">Value</th>
              </tr>
            </thead>
            <tbody>
              {assets.data?.map((a) => (
                <tr key={a.id} className="border-b border-ink-500/20">
                  <td className="py-2 font-mono text-xs">
                    <Link to={`/assets/${a.id}`} className="text-brand-700 hover:underline">{a.assetTag}</Link>
                  </td>
                  <td className="py-2 text-xs">{a.sku.name} <span className="text-ink-300">({a.sku.model})</span></td>
                  <td className="py-2 font-mono text-xs">{a.serialNo ?? '—'}</td>
                  <td className="py-2">
                    {canMove ? (
                      <select className="field" value={a.assignedDepartment?.id ?? ''}
                        onChange={(e) => assign.mutate({ id: a.id, deptId: e.target.value || null })}>
                        <option value="">Unassigned</option>
                        {depts.data?.filter((d) => d.isActive).map((d) => (
                          <option key={d.id} value={d.id}>{d.name}</option>
                        ))}
                      </select>
                    ) : (
                      <span className="text-xs">{a.assignedDepartment?.name ?? '—'}</span>
                    )}
                  </td>
                  <td className="py-2 text-xs">{a.status}</td>
                  <td className="py-2 text-right text-xs">{formatZAR(a.currentValueCents)}</td>
                </tr>
              ))}
              {assets.data?.length === 0 && (
                <tr><td colSpan={6} className="py-6 text-center text-xs text-ink-300">
                  <Building2 size={24} className="mx-auto mb-2 opacity-40" />
                  No HQ assets yet — assets at a Head Office location will appear here.
                </td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
