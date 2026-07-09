import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { PageHeader } from '@/components/PageHeader';
import { formatZAR } from '@itamls/shared';
import { Package, AlertTriangle, ShoppingCart, ArrowUpRight } from 'lucide-react';
import clsx from 'clsx';

export function TonerDashboard() {
  const [year, setYear] = useState(new Date().getFullYear());
  const dash = useQuery({
    queryKey: ['toner-dash', year],
    queryFn: () => api.get('/toner/dashboard', { params: { year } }).then((r) => r.data),
  });

  return (
    <>
      <PageHeader
        title="Toner Dispatching"
        subtitle="Monthly toner planning, dispatching and HQ stock"
        actions={
          <>
            <select className="field max-w-[120px]" value={year} onChange={(e) => setYear(+e.target.value)}>
              {[year - 1, year, year + 1].map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
            <Link to="/toner/orders" className="btn-ghost"><Package size={14}/>Orders</Link>
            <Link to="/toner/plan" className="btn-primary"><ArrowUpRight size={14}/>Plan</Link>
          </>
        }
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
        {dash.data?.perType.map((t: any) => {
          const low = t.hqStock <= t.reorderLevel && t.reorderLevel > 0;
          return (
            <div key={t.id} className={clsx('card p-5', low && 'card-glow')}>
              <div className="flex items-start justify-between">
                <div>
                  <div className="text-[11px] font-semibold uppercase tracking-widest text-ink-200">{t.code}</div>
                  <div className="mt-1 text-sm text-white">{t.name}</div>
                </div>
                {low && <AlertTriangle size={16} className="text-rose-400" />}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-3">
                <Stat label="HQ stock"     value={t.hqStock} tone={low ? 'text-rose-300' : 'text-white'} />
                <Stat label="Annual fcst"  value={t.annualForecast} />
                <Stat label="Dispatched YTD" value={t.dispatchedYtd} />
                <Stat label="Remaining"    value={t.remaining} />
              </div>
              <div className="mt-3 border-t border-ink-500/40 pt-3 text-xs text-ink-200">
                <div className="flex justify-between"><span>Unit cost (ex VAT)</span><span className="font-mono text-white">{formatZAR(t.unitCostCents)}</span></div>
                <div className="flex justify-between"><span>Annual spend</span><span className="font-mono text-white">{formatZAR(t.annualCostCents)}</span></div>
                {t.recommendedPurchase > 0 && (
                  <div className="mt-2 flex items-center gap-2 rounded-md bg-brand-500/10 px-2 py-1.5 text-brand-300">
                    <ShoppingCart size={12}/>
                    <span>Recommended purchase: <b>{t.recommendedPurchase}</b></span>
                  </div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <section className="mt-6 card overflow-hidden">
        <header className="border-b border-ink-500/40 px-5 py-3 text-sm font-semibold text-white">
          Order status — {year}
        </header>
        <div className="grid grid-cols-2 gap-4 p-5 md:grid-cols-5">
          {['DRAFT','DISPATCHED','RECEIVED','CLOSED','CANCELLED'].map((s) => (
            <div key={s} className="rounded-md border border-ink-500/40 bg-ink-700/30 p-3">
              <div className="text-[10px] font-bold uppercase tracking-widest text-ink-200">{s}</div>
              <div className="mt-1 text-2xl font-bold text-white">{dash.data?.ordersByStatus?.[s] ?? 0}</div>
            </div>
          ))}
        </div>
      </section>
    </>
  );
}

function Stat({ label, value, tone = 'text-white' }: { label: string; value: number | string; tone?: string }) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-widest text-ink-200">{label}</div>
      <div className={clsx('font-mono text-xl font-bold', tone)}>{value}</div>
    </div>
  );
}
