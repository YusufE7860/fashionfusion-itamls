import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { PageHeader } from '@/components/PageHeader';
import { Pill } from '@/components/Pill';
import { CheckCircle2, AlertCircle, XCircle } from 'lucide-react';

function StateIcon({ state }: { state: string }) {
  if (state === 'INSTALLED') return <CheckCircle2 className="text-emerald-600" size={18} />;
  if (state === 'PARTIAL')   return <AlertCircle className="text-amber-600" size={18} />;
  return <XCircle className="text-rose-600" size={18} />;
}

export function StoreDetail() {
  const { id } = useParams();
  const store = useQuery({
    queryKey: ['store', id],
    queryFn: () => api.get(`/stores/${id}`).then((r) => r.data),
    enabled: !!id,
  });
  const compliance = useQuery({
    queryKey: ['store-compliance', id],
    queryFn: () => api.get(`/stores/${id}/compliance`).then((r) => r.data),
    enabled: !!id,
  });

  if (!store.data) return <div>Loading…</div>;
  const s = store.data;

  return (
    <>
      <PageHeader title={`${s.code} – ${s.name}`} subtitle={`${s.region}  •  Template: ${s.template?.name ?? '—'}`} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section className="card lg:col-span-2 overflow-hidden">
          <header className="border-b px-4 py-2 text-sm font-semibold text-slate-700">
            Standards compliance
          </header>
          <table className="w-full">
            <thead className="bg-slate-50">
              <tr>
                <th className="th">Category</th>
                <th className="th text-right">Required</th>
                <th className="th text-right">Installed</th>
                <th className="th">Status</th>
              </tr>
            </thead>
            <tbody>
              {compliance.data?.map((c: any) => (
                <tr key={c.templateItemId} className="border-t">
                  <td className="td">{c.categoryName}</td>
                  <td className="td text-right">{c.requiredQty}</td>
                  <td className="td text-right">{c.installedQty}</td>
                  <td className="td">
                    <div className="flex items-center gap-2">
                      <StateIcon state={c.state} />
                      <span className="text-xs">{c.state}</span>
                    </div>
                  </td>
                </tr>
              ))}
              {(!compliance.data || compliance.data.length === 0) && (
                <tr><td className="td" colSpan={4}>No template assigned</td></tr>
              )}
            </tbody>
          </table>
        </section>

        <section className="card overflow-hidden">
          <header className="border-b px-4 py-2 text-sm font-semibold text-slate-700">Assets here</header>
          <ul className="divide-y">
            {s.assignedAssets?.map((a: any) => (
              <li key={a.id} className="flex items-center justify-between px-4 py-2 text-sm">
                <span className="font-mono text-xs">{a.assetTag}</span>
                <span className="text-slate-600">{a.sku.model}</span>
                <Pill status={a.status} />
              </li>
            ))}
            {s.assignedAssets?.length === 0 && (
              <li className="px-4 py-3 text-sm text-slate-500">No assets assigned yet</li>
            )}
          </ul>
        </section>
      </div>
    </>
  );
}
