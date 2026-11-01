import { useMemo } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend,
} from 'recharts';
import { api } from '@/api/client';
import { PageHeader } from '@/components/PageHeader';
import { AlertTriangle, DollarSign, Repeat, TrendingUp, Star } from 'lucide-react';

/**
 * Helpdesk analytics — four tiles backed by existing /helpdesk/metrics/*
 * endpoints: 90-day volume trends, FCR+CSAT, cost per ticket, repeat offenders.
 *
 * This page is deliberately read-only. All data comes from the server; the
 * client just picks a chart style per tile.
 */
export function HelpdeskAnalytics() {
  const trends = useQuery({
    queryKey: ['hd-trends'],
    queryFn: () => api.get('/helpdesk/metrics/trends-90d').then((r) => r.data),
  });
  const fcrCsat = useQuery({
    queryKey: ['hd-fcrcsat'],
    queryFn: () => api.get('/helpdesk/metrics/fcr-csat').then((r) => r.data),
  });
  const cost = useQuery({
    queryKey: ['hd-cost'],
    queryFn: () => api.get('/helpdesk/metrics/cost').then((r) => r.data),
  });
  const repeat = useQuery({
    queryKey: ['hd-repeat'],
    queryFn: () => api.get('/helpdesk/metrics/repeat-offenders').then((r) => r.data),
  });

  // Merge the three trend series into a single row per day for recharts.
  const trendData = useMemo(() => {
    const map = new Map<string, { day: string; created: number; resolved: number; breaches: number }>();
    const add = (rows: any[] | undefined, key: 'created' | 'resolved' | 'breaches') => {
      (rows ?? []).forEach((r) => {
        const d = new Date(r.day).toISOString().slice(0, 10);
        const row = map.get(d) ?? { day: d, created: 0, resolved: 0, breaches: 0 };
        row[key] = Number(r.n ?? 0);
        map.set(d, row);
      });
    };
    add(trends.data?.created,  'created');
    add(trends.data?.resolved, 'resolved');
    add(trends.data?.breaches, 'breaches');
    return [...map.values()].sort((a, b) => a.day.localeCompare(b.day));
  }, [trends.data]);

  const money = (cents: number) => `R${(cents / 100).toFixed(2)}`;

  return (
    <>
      <PageHeader
        title="Helpdesk analytics"
        subtitle="90-day trends, FCR, CSAT, cost per ticket, repeat offenders"
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {/* ---------- 90-day trends ---------- */}
        <section className="card p-4 lg:col-span-2">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700">
            <TrendingUp size={13}/>90-day volume & breaches
          </h3>
          {trendData.length === 0 ? (
            <div className="py-6 text-center text-xs text-ink-300">No data yet.</div>
          ) : (
            <div className="h-64">
              <ResponsiveContainer width="100%" height="100%">
                <LineChart data={trendData}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#eef1f5"/>
                  <XAxis dataKey="day" tick={{ fontSize: 10 }} tickFormatter={(d) => d.slice(5)}/>
                  <YAxis tick={{ fontSize: 10 }}/>
                  <Tooltip />
                  <Legend wrapperStyle={{ fontSize: 11 }}/>
                  <Line type="monotone" dataKey="created"  stroke="#fe6620" strokeWidth={2} dot={false}/>
                  <Line type="monotone" dataKey="resolved" stroke="#10b981" strokeWidth={2} dot={false}/>
                  <Line type="monotone" dataKey="breaches" stroke="#ef4444" strokeWidth={2} dot={false}/>
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </section>

        {/* ---------- FCR + CSAT ---------- */}
        <section className="card p-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700">
            <Star size={13}/>Quality (last 90d)
          </h3>
          {fcrCsat.data ? (
            <div className="grid grid-cols-2 gap-4">
              <div>
                <div className="text-xs text-ink-300">First-contact resolution</div>
                <div className="text-3xl font-bold text-ink-50">
                  {Math.round((fcrCsat.data.fcrRate ?? 0) * 100)}%
                </div>
                <div className="text-[11px] text-ink-300">of {fcrCsat.data.fcrSample} resolved tickets</div>
              </div>
              <div>
                <div className="text-xs text-ink-300">Average CSAT</div>
                <div className="text-3xl font-bold text-ink-50">
                  {fcrCsat.data.csatAvg ? fcrCsat.data.csatAvg.toFixed(2) : '—'}
                  <span className="text-sm text-ink-300"> / 5</span>
                </div>
                <div className="text-[11px] text-ink-300">from {fcrCsat.data.csatSample} ratings</div>
              </div>
            </div>
          ) : <div className="py-6 text-center text-xs text-ink-300">Loading…</div>}
        </section>

        {/* ---------- Cost per ticket ---------- */}
        <section className="card p-4">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700">
            <DollarSign size={13}/>Cost per ticket (last 90d)
          </h3>
          {cost.data ? (
            <>
              <div className="mb-3">
                <div className="text-xs text-ink-300">Average</div>
                <div className="text-3xl font-bold text-ink-50">{money(cost.data.avgCents ?? 0)}</div>
                <div className="text-[11px] text-ink-300">across {cost.data.totalCount} resolved tickets</div>
              </div>
              <table className="w-full text-xs">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="th text-left">Category</th>
                    <th className="th text-right">Count</th>
                    <th className="th text-right">Avg cost</th>
                  </tr>
                </thead>
                <tbody>
                  {(cost.data.byCategory ?? []).map((c: any) => (
                    <tr key={c.category} className="border-t">
                      <td className="py-1.5">{c.category}</td>
                      <td className="py-1.5 text-right">{c.count}</td>
                      <td className="py-1.5 text-right font-mono">{money(c.avgCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          ) : <div className="py-6 text-center text-xs text-ink-300">Loading…</div>}
        </section>

        {/* ---------- Repeat offenders ---------- */}
        <section className="card p-4 lg:col-span-2">
          <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700">
            <Repeat size={13}/>Repeat offenders (≥3 tickets in 90d)
            <AlertTriangle size={11} className="text-amber-500" />
          </h3>
          {!repeat.data?.length ? (
            <div className="py-6 text-center text-xs text-ink-300">
              Nothing to flag — no asset has 3+ tickets in the last 90 days.
            </div>
          ) : (
            <table className="w-full text-xs">
              <thead className="bg-slate-50">
                <tr>
                  <th className="th text-left">Asset tag</th>
                  <th className="th text-left">Model</th>
                  <th className="th text-left">Serial</th>
                  <th className="th text-right">Ticket count (90d)</th>
                </tr>
              </thead>
              <tbody>
                {repeat.data.map((r: any) => (
                  <tr key={r.asset?.id ?? r.asset?.assetTag} className="border-t">
                    <td className="py-1.5 font-mono">{r.asset?.assetTag ?? '—'}</td>
                    <td className="py-1.5">{r.asset?.sku?.name ?? '—'}</td>
                    <td className="py-1.5 font-mono text-ink-300">{r.asset?.serialNo ?? '—'}</td>
                    <td className="py-1.5 text-right font-semibold">{r.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </>
  );
}
