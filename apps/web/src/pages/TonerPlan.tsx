import { useState, useMemo, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { PageHeader } from '@/components/PageHeader';
import { formatZAR, MONTHS } from '@itamls/shared';
import { Save } from 'lucide-react';
import clsx from 'clsx';

export function TonerPlan() {
  const qc = useQueryClient();
  const [year, setYear] = useState(new Date().getFullYear());
  const [entity, setEntity] = useState<'ALL' | 'FASHION_FUSION' | 'EVLV'>('ALL');

  const stores = useQuery({ queryKey: ['stores'], queryFn: () => api.get('/stores').then((r) => r.data) });
  const types  = useQuery({ queryKey: ['toner-types'], queryFn: () => api.get('/toner/types').then((r) => r.data) });
  const plans  = useQuery({ queryKey: ['toner-plan', year], queryFn: () => api.get('/toner/plan', { params: { year } }).then((r) => r.data) });
  const summary = useQuery({ queryKey: ['toner-plan-summary', year], queryFn: () => api.get('/toner/plan/summary', { params: { year } }).then((r) => r.data) });

  // map plan rows by storeId|typeId
  const planMap = useMemo(() => {
    const m = new Map<string, any>();
    for (const p of plans.data ?? []) m.set(`${p.storeId}|${p.tonerTypeId}`, p);
    return m;
  }, [plans.data]);

  // Local edits — keyed the same way; value is full row (jan..dec)
  const [edits, setEdits] = useState<Record<string, any>>({});
  useEffect(() => { setEdits({}); }, [year]);

  const upsert = useMutation({
    mutationFn: (body: any) => api.post('/toner/plan', body).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['toner-plan', year] });
      qc.invalidateQueries({ queryKey: ['toner-plan-summary', year] });
      qc.invalidateQueries({ queryKey: ['toner-dash', year] });
    },
  });

  const filteredStores = (stores.data ?? []).filter((s: any) => entity === 'ALL' || s.entity === entity);

  function getVal(storeId: string, tonerTypeId: string, m: string) {
    const k = `${storeId}|${tonerTypeId}`;
    const e = edits[k];
    if (e && e[m] !== undefined) return e[m];
    const p = planMap.get(k);
    return p?.[m] ?? 0;
  }
  function setVal(storeId: string, tonerTypeId: string, m: string, v: number) {
    const k = `${storeId}|${tonerTypeId}`;
    const p = planMap.get(k);
    const base = p ?? Object.fromEntries(MONTHS.map((x) => [x, 0]));
    setEdits((prev) => ({ ...prev, [k]: { ...base, ...(prev[k] ?? {}), [m]: v } }));
  }
  function isDirty(storeId: string, tonerTypeId: string) {
    return !!edits[`${storeId}|${tonerTypeId}`];
  }
  function saveRow(storeId: string, tonerTypeId: string) {
    const k = `${storeId}|${tonerTypeId}`;
    const e = edits[k];
    if (!e) return;
    const body: any = { storeId, tonerTypeId, year };
    for (const m of MONTHS) body[m] = e[m] ?? 0;
    upsert.mutate(body, {
      onSuccess: () => setEdits((prev) => { const { [k]: _, ...rest } = prev; return rest; }),
    });
  }

  return (
    <>
      <PageHeader
        title="Annual Toner Plan"
        subtitle="Set the monthly quantity each store needs for each toner type"
        actions={
          <>
            <select className="field max-w-[140px]" value={entity} onChange={(e) => setEntity(e.target.value as any)}>
              <option value="ALL">All entities</option>
              <option value="FASHION_FUSION">Fashion Fusion</option>
              <option value="EVLV">EVLV</option>
            </select>
            <select className="field max-w-[120px]" value={year} onChange={(e) => setYear(+e.target.value)}>
              {[year - 1, year, year + 1].map((y) => <option key={y} value={y}>{y}</option>)}
            </select>
          </>
        }
      />

      {/* Annual summary by entity × toner */}
      {summary.data && summary.data.length > 0 && (
        <div className="card mb-4 overflow-hidden">
          <header className="border-b border-ink-500/40 px-5 py-3 text-sm font-semibold text-white">
            Annual summary — {year}
          </header>
          <table className="w-full">
            <thead>
              <tr>
                <th className="th">Entity</th><th className="th">Toner</th>
                {MONTHS.map((m) => <th key={m} className="th text-right">{m.toUpperCase()}</th>)}
                <th className="th text-right">Total qty</th>
                <th className="th text-right">Total cost</th>
              </tr>
            </thead>
            <tbody>
              {summary.data.map((s: any, i: number) => (
                <tr key={i} className="border-t border-ink-500/30">
                  <td className="td">{s.entity === 'EVLV' ? 'EVLV' : 'Fashion Fusion'}</td>
                  <td className="td font-mono">{s.tonerCode}</td>
                  {s.perMonth.map((v: number, j: number) => <td key={j} className="td text-right font-mono">{v || ''}</td>)}
                  <td className="td text-right font-mono text-white">{s.totalQty}</td>
                  <td className="td text-right font-mono">{formatZAR(s.totalCostCents)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <p className="mb-2 text-xs text-ink-200">
        Tap a month cell, change the number, then click <b>Save</b> in the right-most column.
      </p>

      {types.data?.map((tonerType: any) => (
        <details key={tonerType.id} open className="card mb-4 overflow-hidden">
          <summary className="cursor-pointer border-b border-ink-500/40 px-5 py-3">
            <span className="font-mono text-brand-300">{tonerType.code}</span>{' '}
            <span className="text-white">{tonerType.name}</span>{' '}
            <span className="text-xs text-ink-200">— {formatZAR(tonerType.unitCostCents)} per unit ex VAT</span>
          </summary>
          <table className="w-full">
            <thead>
              <tr>
                <th className="th sticky left-0 z-10 bg-ink-700/80">Store</th>
                <th className="th">Entity</th>
                {MONTHS.map((m) => <th key={m} className="th text-right">{m.toUpperCase()}</th>)}
                <th className="th text-right">Year</th>
                <th className="th"></th>
              </tr>
            </thead>
            <tbody>
              {filteredStores.map((store: any) => {
                const yearTotal = MONTHS.reduce((s, m) => s + getVal(store.id, tonerType.id, m), 0);
                const dirty = isDirty(store.id, tonerType.id);
                return (
                  <tr key={store.id} className={clsx('border-t border-ink-500/30', dirty && 'bg-brand-500/5')}>
                    <td className="td sticky left-0 z-10 bg-ink-700/80 text-white">
                      <span className="font-mono text-xs text-ink-200">{store.code}</span> {store.name}
                    </td>
                    <td className="td text-xs">
                      <span className={clsx('pill', store.entity === 'EVLV' ? 'pill-gold' : 'pill-brand')}>
                        {store.entity === 'EVLV' ? 'EVLV' : 'FF'}
                      </span>
                    </td>
                    {MONTHS.map((m) => (
                      <td key={m} className="td">
                        <input
                          type="number" min={0}
                          className="field w-14 text-right font-mono"
                          value={getVal(store.id, tonerType.id, m)}
                          onChange={(e) => setVal(store.id, tonerType.id, m, Math.max(0, +e.target.value))}
                        />
                      </td>
                    ))}
                    <td className="td text-right font-mono text-white">{yearTotal}</td>
                    <td className="td text-right">
                      {dirty && (
                        <button className="btn-primary"
                          disabled={upsert.isPending}
                          onClick={() => saveRow(store.id, tonerType.id)}>
                          <Save size={12}/>Save
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </details>
      ))}
    </>
  );
}
