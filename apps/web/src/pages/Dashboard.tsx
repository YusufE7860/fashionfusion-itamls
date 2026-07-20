import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { api } from '@/api/client';
import { PageHeader } from '@/components/PageHeader';
import {
  Boxes, ShieldCheck, AlertTriangle, Warehouse, Bell,
  TrendingUp, ArrowUpRight, Activity,
} from 'lucide-react';
import { formatZAR } from '@itamls/shared';
import clsx from 'clsx';

function Kpi({
  label, value, hint, icon: Icon, tone, to,
}: {
  label: string; value: string; hint?: string; icon: any; tone: string; to?: string;
}) {
  const inner = (
    <div className="card card-hover group relative p-5">
      <div className="flex items-start justify-between">
        <div>
          <div className="text-[11px] font-semibold uppercase tracking-widest text-ink-400">{label}</div>
          <div className="mt-2 font-display text-3xl font-bold tracking-tight text-ink-50">{value}</div>
          {hint && <div className="mt-1 text-xs text-ink-400">{hint}</div>}
        </div>
        <div className={clsx('grid h-10 w-10 place-items-center rounded-lg', tone)}>
          <Icon size={18} className="text-white" />
        </div>
      </div>
      {to && (
        <div className="mt-4 inline-flex items-center gap-1 text-xs font-medium text-brand-600 opacity-0 transition-opacity group-hover:opacity-100">
          View <ArrowUpRight size={12} />
        </div>
      )}
    </div>
  );
  return to ? <Link to={to}>{inner}</Link> : inner;
}

function ComplianceBar({ pct }: { pct: number }) {
  const tone =
    pct >= 100 ? 'bg-emerald-500'
    : pct >= 60  ? 'bg-brand-500'
                 : 'bg-rose-500';
  return (
    <div className="h-1.5 w-32 overflow-hidden rounded-full bg-ink-500">
      <div className={clsx('h-full', tone)} style={{ width: `${Math.min(100, pct)}%` }} />
    </div>
  );
}

export function Dashboard() {
  const assets = useQuery({ queryKey: ['assets'], queryFn: () => api.get('/assets').then((r) => r.data) });
  const stock = useQuery({ queryKey: ['stock'], queryFn: () => api.get('/stock').then((r) => r.data) });
  const compliance = useQuery({
    queryKey: ['compliance', 'summary'],
    queryFn: () => api.get('/compliance/summary').then((r) => r.data),
  });
  const alerts = useQuery({
    queryKey: ['alerts-summary'],
    queryFn: () => api.get('/alerts/summary').then((r) => r.data),
  });
  const recentAlerts = useQuery({
    queryKey: ['alerts'],
    queryFn: () => api.get('/alerts').then((r) => r.data),
  });

  const totalAssets = assets.data?.length ?? 0;
  const totalValueCents = assets.data?.reduce((s: number, a: any) => s + (a.currentValueCents ?? 0), 0) ?? 0;
  const compliantStores = compliance.data?.filter((c: any) => c.compliantPct >= 100).length ?? 0;
  const totalStores = compliance.data?.length ?? 0;

  return (
    <>
      <PageHeader
        title="Overview"
        subtitle="Real-time view of your IT estate across Fashion Fusion"
        actions={
          <div className="flex items-center gap-2 rounded-full border border-ink-500 bg-white px-3 py-1 text-[11px] text-ink-200">
            <Activity size={12} className="text-emerald-500 animate-pulse"/> Live
          </div>
        }
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-5">
        <Kpi label="Total assets" value={String(totalAssets)} icon={Boxes} tone="bg-brand-500" to="/assets" />
        <Kpi label="Asset value" value={formatZAR(totalValueCents)} hint="Current book value" icon={Warehouse} tone="bg-emerald-500" />
        <Kpi label="Compliant stores" value={`${compliantStores}/${totalStores}`} icon={ShieldCheck} tone="bg-amber-500" to="/stores" />
        <Kpi label="Stock rows" value={String(stock.data?.length ?? 0)} icon={AlertTriangle} tone="bg-rose-500" to="/stock" />
        <Kpi label="Active alerts" value={String(alerts.data?.active ?? 0)} icon={Bell} tone="bg-teal-500" to="/alerts" />
      </div>

      <section className="mt-8 grid grid-cols-1 gap-4 lg:grid-cols-3">
        <div className="card overflow-hidden lg:col-span-2">
          <header className="flex items-center justify-between border-b border-ink-500 px-5 py-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-ink-50">
              <ShieldCheck size={14} className="text-brand-500" />
              Store compliance
            </div>
            <Link to="/stores" className="text-[11px] text-brand-600 hover:underline">All stores →</Link>
          </header>
          <table className="w-full">
            <thead>
              <tr>
                <th className="th">Store</th>
                <th className="th">Compliance</th>
                <th className="th text-right">Missing</th>
              </tr>
            </thead>
            <tbody>
              {compliance.data?.map((c: any) => (
                <tr key={c.storeId} className="border-t border-ink-500">
                  <td className="td">
                    <Link to={`/stores/${c.storeId}`} className="text-ink-50 hover:text-brand-600">
                      <span className="font-mono text-xs text-ink-400">{c.storeCode}</span> · {c.storeName}
                    </Link>
                  </td>
                  <td className="td">
                    <div className="flex items-center gap-2.5">
                      <ComplianceBar pct={c.compliantPct} />
                      <span className="font-mono text-xs text-ink-200">{c.compliantPct}%</span>
                    </div>
                  </td>
                  <td className="td text-right font-mono">
                    {c.missing === 0
                      ? <span className="pill-green">0</span>
                      : <span className="pill-amber">{c.missing}</span>}
                  </td>
                </tr>
              ))}
              {compliance.data?.length === 0 && (
                <tr><td className="td" colSpan={3}>No stores yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        <div className="card overflow-hidden">
          <header className="flex items-center justify-between border-b border-ink-500 px-5 py-3">
            <div className="flex items-center gap-2 text-sm font-semibold text-ink-50">
              <Bell size={14} className="text-brand-500"/>
              Top alerts
            </div>
            <Link to="/alerts" className="text-[11px] text-brand-600 hover:underline">View all →</Link>
          </header>
          <ul>
            {recentAlerts.data?.slice(0, 6).map((a: any) => (
              <li key={a.id} className="border-b border-ink-500 px-5 py-3 text-sm last:border-b-0">
                <div className="flex items-start gap-2.5">
                  <span className={clsx(
                    'mt-1.5 inline-block h-1.5 w-1.5 rounded-full',
                    a.severity === 'ERROR' && 'bg-rose-500',
                    a.severity === 'WARN'  && 'bg-amber-500',
                    a.severity === 'INFO'  && 'bg-sky-500',
                  )} />
                  <span className="text-ink-100">{a.message}</span>
                </div>
              </li>
            ))}
            {(!recentAlerts.data || recentAlerts.data.length === 0) && (
              <li className="px-5 py-6 text-center text-sm text-ink-400">All clear — no active alerts.</li>
            )}
          </ul>
        </div>
      </section>

      <section className="mt-4 card overflow-hidden">
        <header className="flex items-center justify-between border-b border-ink-500 px-5 py-3">
          <div className="flex items-center gap-2 text-sm font-semibold text-ink-50">
            <TrendingUp size={14} className="text-brand-500"/>
            Latest assets
          </div>
          <Link to="/assets" className="text-[11px] text-brand-600 hover:underline">All assets →</Link>
        </header>
        <table className="w-full">
          <thead>
            <tr>
              <th className="th">Tag</th>
              <th className="th">Model</th>
              <th className="th">Status</th>
              <th className="th text-right">Value</th>
            </tr>
          </thead>
          <tbody>
            {assets.data?.slice(0, 8).map((a: any) => (
              <tr key={a.id} className="border-t border-ink-500">
                <td className="td">
                  <Link to={`/assets/${a.id}`} className="font-mono text-xs text-brand-600 hover:underline">{a.assetTag}</Link>
                </td>
                <td className="td">{a.sku?.manufacturer} {a.sku?.model}</td>
                <td className="td">
                  <span className={clsx(
                    a.status === 'IN_STORE' && 'pill-green',
                    a.status === 'IN_STOCK' && 'pill-blue',
                    a.status === 'IN_TRANSIT' && 'pill-amber',
                    a.status === 'REPAIR' && 'pill-amber',
                    (a.status === 'DAMAGED' || a.status === 'LOST') && 'pill-red',
                  )}>{a.status.replaceAll('_',' ')}</span>
                </td>
                <td className="td text-right font-mono">{formatZAR(a.currentValueCents)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
