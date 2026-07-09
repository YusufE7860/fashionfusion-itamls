import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { PageHeader } from '@/components/PageHeader';
import { formatZAR } from '@itamls/shared';
import { Save, Search, X, ExternalLink } from 'lucide-react';
import clsx from 'clsx';

export function Skus() {
  const skus = useQuery({ queryKey: ['skus'], queryFn: () => api.get('/skus').then((r) => r.data) });
  return (
    <>
      <PageHeader
        title="SKUs & Pricing"
        subtitle="Catalogue prices feed every discovered asset's value"
      />
      <div className="card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr>
              <th className="th">Code</th><th className="th">Name</th>
              <th className="th">Category</th><th className="th">Make / Model</th>
              <th className="th text-right">Unit cost (cents)</th>
              <th className="th text-right">Warranty (mo)</th>
              <th className="th text-right">Depreciation (yr)</th>
              <th className="th"></th>
            </tr>
          </thead>
          <tbody>
            {skus.data?.map((s: any) => <SkuRow key={s.id} sku={s} />)}
          </tbody>
        </table>
      </div>
    </>
  );
}

function SkuRow({ sku }: { sku: any }) {
  const qc = useQueryClient();
  const [edit, setEdit] = useState({
    unitCostCents: sku.unitCostCents,
    warrantyMonths: sku.warrantyMonths,
    depreciationYears: sku.depreciationYears,
  });
  const [cascade, setCascade] = useState(true);
  const [showLookup, setShowLookup] = useState(false);
  const dirty =
    edit.unitCostCents !== sku.unitCostCents ||
    edit.warrantyMonths !== sku.warrantyMonths ||
    edit.depreciationYears !== sku.depreciationYears;

  const update = useMutation({
    mutationFn: () => api.patch(`/skus/${sku.id}`, { ...edit, cascadeToAssets: cascade }).then((r) => r.data),
    onSuccess: (res: any) => {
      qc.invalidateQueries({ queryKey: ['skus'] });
      qc.invalidateQueries({ queryKey: ['assets'] });
      if (res?.updatedAssets > 0) {
        alert(`Saved. Backfilled value on ${res.updatedAssets} existing asset(s).`);
      }
    },
  });

  return (
    <>
      <tr className={clsx('border-t border-ink-500/30', dirty && 'bg-brand-500/5')}>
        <td className="td font-mono">{sku.code}</td>
        <td className="td">{sku.name}</td>
        <td className="td">{sku.category?.name}</td>
        <td className="td">{sku.manufacturer} {sku.model}</td>
        <td className="td text-right">
          <div className="flex items-center justify-end gap-2">
            <input type="number" min={0} className="field w-32 text-right font-mono"
              value={edit.unitCostCents}
              onChange={(e) => setEdit({ ...edit, unitCostCents: +e.target.value })} />
            <button title="Look up web price" className="btn-ghost"
                    onClick={() => setShowLookup(true)}>
              <Search size={12}/>
            </button>
          </div>
          <div className="mt-1 text-[10px] text-ink-200">{formatZAR(edit.unitCostCents)}</div>
        </td>
        <td className="td text-right">
          <input type="number" min={0} className="field w-20 text-right font-mono"
            value={edit.warrantyMonths}
            onChange={(e) => setEdit({ ...edit, warrantyMonths: +e.target.value })} />
        </td>
        <td className="td text-right">
          <input type="number" min={0} className="field w-20 text-right font-mono"
            value={edit.depreciationYears}
            onChange={(e) => setEdit({ ...edit, depreciationYears: +e.target.value })} />
        </td>
        <td className="td text-right">
          {dirty && (
            <div className="flex flex-col items-end gap-1">
              <label className="flex items-center gap-1 text-[11px] text-ink-200">
                <input type="checkbox" checked={cascade} onChange={(e) => setCascade(e.target.checked)} />
                Apply to zero-value assets
              </label>
              <button className="btn-primary" disabled={update.isPending} onClick={() => update.mutate()}>
                <Save size={12}/>Save
              </button>
            </div>
          )}
        </td>
      </tr>
      {showLookup && (
        <PriceLookupRow sku={sku}
          onClose={() => setShowLookup(false)}
          onPick={(cents) => { setEdit({ ...edit, unitCostCents: cents }); setShowLookup(false); }} />
      )}
    </>
  );
}

function PriceLookupRow({ sku, onClose, onPick }: { sku: any; onClose: () => void; onPick: (cents: number) => void }) {
  const lookup = useQuery({
    queryKey: ['price-lookup', sku.manufacturer, sku.model],
    queryFn: () => api.get('/price-lookup', { params: { manufacturer: sku.manufacturer, model: sku.model } }).then((r) => r.data),
  });

  return (
    <tr className="bg-ink-700/30">
      <td colSpan={8} className="td">
        <div className="rounded-md border border-brand-500/30 bg-ink-700/40 p-4">
          <div className="mb-3 flex items-center justify-between">
            <div>
              <div className="text-[11px] font-bold uppercase tracking-wider text-brand-300">
                Web price lookup — {sku.manufacturer} {sku.model}
              </div>
              <div className="mt-0.5 text-[11px] text-ink-200">
                Provider: <code className="rounded bg-ink-900/40 px-1">{lookup.data?.provider ?? 'loading…'}</code>
              </div>
            </div>
            <button className="btn-ghost" onClick={onClose}><X size={14}/></button>
          </div>

          {lookup.isLoading && <div className="text-sm text-ink-200">Searching…</div>}

          {/* Quote cards from SERPAPI (if configured) */}
          {!!lookup.data?.quotes?.length && (
            <>
              <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-ink-200">Live quotes</div>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-3">
                {lookup.data.quotes.map((q: any, i: number) => (
                  <button key={i} onClick={() => onPick(q.priceCents)}
                          className="group rounded-md border border-ink-500/40 bg-ink-900/40 p-3 text-left hover:border-brand-500/60">
                    <div className="text-[11px] text-brand-300">{q.vendor}</div>
                    <div className="mt-1 truncate text-sm text-white">{q.title}</div>
                    <div className="mt-2 font-mono text-lg font-bold text-white">{formatZAR(q.priceCents)}</div>
                    <div className="mt-1 text-[10px] text-ink-200 group-hover:text-brand-300">Click to use this price →</div>
                  </button>
                ))}
              </div>
              {lookup.data.suggestedCents > 0 && (
                <button className="btn-primary mt-3" onClick={() => onPick(lookup.data.suggestedCents)}>
                  Use median: {formatZAR(lookup.data.suggestedCents)}
                </button>
              )}
            </>
          )}

          {/* Always: clickable search links */}
          {lookup.data?.searchLinks?.length > 0 && (
            <div className="mt-3">
              <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-ink-200">
                {lookup.data.quotes?.length ? 'Or search elsewhere' : 'Search the web'}
              </div>
              <div className="flex flex-wrap gap-2">
                {lookup.data.searchLinks.map((l: any, i: number) => (
                  <a key={i} href={l.url} target="_blank" rel="noreferrer"
                     className="inline-flex items-center gap-1.5 rounded-md border border-ink-500/40 bg-ink-700/40 px-3 py-1.5 text-xs text-white hover:border-brand-500/40 hover:text-brand-300">
                    {l.label} <ExternalLink size={11}/>
                  </a>
                ))}
              </div>
              <p className="mt-2 text-[11px] text-ink-200">
                Click a link, copy the price into the field above and Save. Switch to fully automatic lookups by adding a <code className="rounded bg-ink-900/40 px-1">SERPAPI_KEY</code> in <code className="rounded bg-ink-900/40 px-1">apps/api/.env</code>.
              </p>
            </div>
          )}
        </div>
      </td>
    </tr>
  );
}
