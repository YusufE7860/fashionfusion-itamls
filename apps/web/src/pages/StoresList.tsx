import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { PageHeader } from '@/components/PageHeader';

export function StoresList() {
  const stores = useQuery({ queryKey: ['stores'], queryFn: () => api.get('/stores').then((r) => r.data) });
  return (
    <>
      <PageHeader
        title="Stores"
        subtitle="Every Fashion Fusion retail location"
        actions={<Link to="/stores/wizard" className="btn-primary">New store wizard</Link>}
      />
      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {stores.data?.map((s: any) => (
          <Link key={s.id} to={`/stores/${s.id}`} className="card p-4 hover:border-brand-400">
            <div className="text-xs uppercase tracking-wide text-slate-500">{s.region}</div>
            <div className="mt-1 text-lg font-semibold">{s.code} – {s.name}</div>
            <div className="mt-2 text-sm text-slate-600">Template: {s.template?.name ?? '—'}</div>
            <div className="text-xs text-slate-500">Status: {s.status}</div>
          </Link>
        ))}
      </div>
    </>
  );
}
