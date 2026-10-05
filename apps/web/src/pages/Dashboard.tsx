import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { PageHeader } from '@/components/PageHeader';
import {
  AlertTriangle, ArrowDown, ArrowUp, CheckCircle2, Pencil, Plus, Settings2, Trash2, X,
} from 'lucide-react';
import clsx from 'clsx';

/**
 * Customisable per-user dashboard. The server registry defines what widgets
 * exist; the user picks which ones they want on their own board. This page is
 * just a renderer — every widget's data comes from /dashboard/widgets/:id/data.
 */
export function Dashboard() {
  const qc = useQueryClient();
  const [editMode, setEditMode] = useState(false);
  const [showCatalog, setShowCatalog] = useState(false);

  const widgets = useQuery({
    queryKey: ['dashboard-widgets'],
    queryFn: () => api.get('/dashboard/widgets').then((r) => r.data as any[]),
  });

  const refresh = () => qc.invalidateQueries({ queryKey: ['dashboard-widgets'] });

  const move = useMutation({
    mutationFn: (ids: string[]) => api.post('/dashboard/widgets/reorder', { ids }).then((r) => r.data),
    onSuccess: refresh,
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/dashboard/widgets/${id}`).then((r) => r.data),
    onSuccess: refresh,
  });
  const updateWidth = useMutation({
    mutationFn: ({ id, width }: { id: string; width: 'S' | 'M' | 'L' }) =>
      api.patch(`/dashboard/widgets/${id}`, { width }).then((r) => r.data),
    onSuccess: refresh,
  });

  function moveWidget(idx: number, dir: -1 | 1) {
    const items = [...(widgets.data ?? [])];
    const target = idx + dir;
    if (target < 0 || target >= items.length) return;
    [items[idx], items[target]] = [items[target], items[idx]];
    move.mutate(items.map((w) => w.id));
  }

  return (
    <>
      <PageHeader
        title="Dashboard"
        subtitle="Your workspace — pick what you want to see here"
        actions={
          <>
            <button className={clsx('btn-ghost', editMode && 'bg-brand-500/10 text-brand-700 ring-1 ring-brand-400')}
              onClick={() => setEditMode((v) => !v)}>
              <Pencil size={13}/>{editMode ? 'Done editing' : 'Edit'}
            </button>
            {editMode && (
              <button className="btn-primary" onClick={() => setShowCatalog(true)}>
                <Plus size={13}/>Add widget
              </button>
            )}
          </>
        }
      />

      {widgets.data?.length === 0 && (
        <div className="card p-6 text-center">
          <h3 className="text-lg font-semibold">Your dashboard is empty</h3>
          <p className="mt-1 text-sm text-ink-300">Click <b>Edit</b> then <b>Add widget</b> to build it.</p>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-6">
        {widgets.data?.map((w: any, idx: number) => (
          <WidgetFrame
            key={w.id}
            widget={w}
            editMode={editMode}
            onRemove={() => { if (confirm('Remove this widget?')) remove.mutate(w.id); }}
            onMoveUp={() => moveWidget(idx, -1)}
            onMoveDown={() => moveWidget(idx, 1)}
            onWidth={(width) => updateWidth.mutate({ id: w.id, width })}
          />
        ))}
      </div>

      {showCatalog && <CatalogDrawer onClose={() => setShowCatalog(false)} onAdded={refresh} />}
    </>
  );
}

// =========================================================================
//  Widget frame + body renderer
// =========================================================================
function WidgetFrame({
  widget, editMode, onRemove, onMoveUp, onMoveDown, onWidth,
}: {
  widget: any;
  editMode: boolean;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onWidth: (w: 'S' | 'M' | 'L') => void;
}) {
  const colSpan = widget.width === 'S' ? 'md:col-span-2' : widget.width === 'L' ? 'md:col-span-6' : 'md:col-span-3';

  const data = useQuery({
    queryKey: ['widget', widget.id],
    queryFn: () => api.get(`/dashboard/widgets/${widget.id}/data`).then((r) => r.data),
    refetchInterval: 60_000,
  });

  return (
    <section className={clsx('card flex flex-col p-3', colSpan)}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <h3 className="truncate text-sm font-semibold text-slate-700">
          {data.data?.title ?? widget.title ?? widget.type}
        </h3>
        {editMode ? (
          <div className="flex items-center gap-0.5">
            {(['S','M','L'] as const).map((w) => (
              <button key={w} className={clsx(
                'rounded px-1.5 py-0.5 text-[10px] font-semibold',
                widget.width === w ? 'bg-brand-500/15 text-brand-700' : 'text-ink-300 hover:text-ink-100',
              )} onClick={() => onWidth(w)} title={w === 'S' ? 'Small' : w === 'M' ? 'Medium' : 'Large'}>
                {w}
              </button>
            ))}
            <button className="btn-ghost !p-1" onClick={onMoveUp} title="Move up"><ArrowUp size={12}/></button>
            <button className="btn-ghost !p-1" onClick={onMoveDown} title="Move down"><ArrowDown size={12}/></button>
            <button className="btn-ghost !p-1 text-rose-500" onClick={onRemove} title="Remove"><Trash2 size={12}/></button>
          </div>
        ) : null}
      </div>

      <div className="flex-1">
        {data.isLoading && <div className="py-6 text-center text-xs text-ink-300">Loading…</div>}
        {data.data?.error && <div className="py-3 text-xs text-rose-500">{data.data.error}</div>}
        {data.data && !data.data.error && <WidgetBody widget={widget} spec={data.data} />}
      </div>
    </section>
  );
}

function WidgetBody({ widget, spec }: { widget: any; spec: any }) {
  const kind = spec.kind;
  const p = spec.payload;
  if (!p) return <div className="text-xs text-ink-300">No data</div>;

  switch (kind) {
    case 'stat':
      return (
        <div>
          <div className={clsx(
            'text-4xl font-bold',
            p.intent === 'warning' ? 'text-amber-500' : p.intent === 'danger' ? 'text-rose-500' : 'text-ink-50',
          )}>{p.value}</div>
          {p.sub && <div className="mt-1 text-xs text-ink-300">{p.sub}</div>}
        </div>
      );

    case 'list':
      return (
        <ul className="divide-y divide-ink-500/10">
          {(p.items ?? []).length === 0 && <li className="py-2 text-xs text-ink-300">Nothing here</li>}
          {(p.items ?? []).map((row: any) => (
            <li key={row.id ?? row.code ?? JSON.stringify(row)} className="py-1.5 text-xs">
              {widget.type.startsWith('tickets.') ? (
                <Link to={`/helpdesk/tickets/${row.id}`} className="flex items-center justify-between gap-2 hover:text-brand-700">
                  <span className="truncate">
                    <span className="font-mono text-[10px] text-ink-300">{row.code}</span>{' '}
                    <span className="text-ink-100">{row.subject}</span>
                  </span>
                  <span className="flex shrink-0 items-center gap-1 text-[10px] text-ink-300">
                    {row.store?.code && <span>{row.store.code}</span>}
                    {row.priority && <span className="rounded bg-slate-100 px-1 font-mono">{row.priority}</span>}
                  </span>
                </Link>
              ) : widget.type.startsWith('assets.') ? (
                <Link to={`/assets/${row.id}`} className="flex items-center justify-between gap-2 hover:text-brand-700">
                  <span className="truncate">
                    <span className="font-mono text-[10px]">{row.assetTag}</span>{' '}
                    <span className="text-ink-100">{row.sku?.name}</span>
                  </span>
                  <span className="shrink-0 text-[10px] text-ink-300">
                    {row.warrantyExpiry && new Date(row.warrantyExpiry).toLocaleDateString()}
                  </span>
                </Link>
              ) : (
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-ink-100">{row.name ?? row.code ?? JSON.stringify(row).slice(0, 60)}</span>
                  {row.qty !== undefined && <span className="shrink-0 font-mono text-[10px] text-rose-500">{row.qty}</span>}
                </div>
              )}
            </li>
          ))}
        </ul>
      );

    case 'barChart':
      return <BarChartMini data={p.data ?? []} />;

    case 'pieChart':
      return <PieChartMini data={p.data ?? []} />;

    default:
      return <pre className="overflow-auto text-[10px] text-ink-300">{JSON.stringify(p, null, 2)}</pre>;
  }
}

// Dependency-free tiny charts
function BarChartMini({ data }: { data: { label: string; sublabel?: string; value: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <ul className="space-y-1">
      {data.length === 0 && <li className="text-xs text-ink-300">No data</li>}
      {data.map((d) => (
        <li key={d.label} className="flex items-center gap-2 text-xs">
          <div className="w-16 truncate font-mono text-[10px] text-ink-100" title={d.sublabel}>{d.label}</div>
          <div className="relative h-3 flex-1 overflow-hidden rounded bg-slate-100">
            <div className="h-full bg-gradient-to-r from-brand-400 to-brand-600" style={{ width: `${(d.value / max) * 100}%` }} />
          </div>
          <div className="w-6 text-right font-mono text-[10px] text-ink-300">{d.value}</div>
        </li>
      ))}
    </ul>
  );
}

const PIE_COLOURS = ['#e11d48','#f59e0b','#0ea5e9','#94a3b8','#10b981','#7c3aed','#f97316'];
function PieChartMini({ data }: { data: { label: string; value: number }[] }) {
  const total = Math.max(1, data.reduce((s, d) => s + d.value, 0));
  let acc = 0;
  const r = 32, cx = 40, cy = 40;
  return (
    <div className="flex items-center gap-3">
      <svg width={80} height={80} viewBox="0 0 80 80">
        {data.map((d, i) => {
          const start = (acc / total) * Math.PI * 2;
          acc += d.value;
          const end = (acc / total) * Math.PI * 2;
          const large = end - start > Math.PI ? 1 : 0;
          const x1 = cx + r * Math.sin(start), y1 = cy - r * Math.cos(start);
          const x2 = cx + r * Math.sin(end),   y2 = cy - r * Math.cos(end);
          return <path key={d.label}
            d={`M ${cx} ${cy} L ${x1} ${y1} A ${r} ${r} 0 ${large} 1 ${x2} ${y2} Z`}
            fill={PIE_COLOURS[i % PIE_COLOURS.length]} />;
        })}
      </svg>
      <ul className="flex-1 space-y-0.5 text-xs">
        {data.map((d, i) => (
          <li key={d.label} className="flex items-center gap-1.5">
            <span className="h-2 w-2 rounded-sm" style={{ background: PIE_COLOURS[i % PIE_COLOURS.length] }} />
            <span className="font-mono text-[10px] text-ink-100">{d.label}</span>
            <span className="ml-auto text-[10px] text-ink-300">{d.value}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// =========================================================================
//  Catalog drawer — pick what to add
// =========================================================================
function CatalogDrawer({ onClose, onAdded }: { onClose: () => void; onAdded: () => void }) {
  const cat = useQuery({
    queryKey: ['dashboard-catalog'],
    queryFn: () => api.get('/dashboard/catalog').then((r) => r.data as Array<{ category: string; items: any[] }>),
  });
  const [justAdded, setJustAdded] = useState<string | null>(null);
  const add = useMutation({
    mutationFn: (item: any) => api.post('/dashboard/widgets', { type: item.type, width: item.defaultWidth }).then((r) => r.data),
    onSuccess: (_, item: any) => { setJustAdded(item.type); onAdded(); },
    onError: (e: any) => { alert(`Could not add widget: ${e?.response?.data?.message ?? e.message}`); },
  });

  return (
    <div className="fixed inset-0 z-40 flex" onClick={onClose}>
      <div className="flex-1 bg-black/40"/>
      <div className="w-full max-w-md overflow-y-auto bg-white p-5 shadow-xl" onClick={(e) => e.stopPropagation()}>
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">Add widget</h2>
          <button className="btn-ghost" onClick={onClose}><X size={13}/></button>
        </div>
        {cat.isLoading && <div className="text-sm text-ink-300">Loading catalog…</div>}
        {cat.data?.map((group) => (
          <div key={group.category} className="mb-5">
            <h3 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-brand-600">{group.category}</h3>
            <div className="space-y-2">
              {group.items.map((item: any) => {
                const added = justAdded === item.type;
                return (
                  <button key={item.type}
                    disabled={add.isPending}
                    className={clsx(
                      'w-full rounded-lg border p-3 text-left transition-colors',
                      added
                        ? 'border-emerald-400 bg-emerald-50'
                        : 'border-ink-500/20 bg-white hover:border-brand-400 hover:bg-brand-50/40',
                    )}
                    onClick={() => add.mutate(item)}>
                    <div className="flex items-start justify-between gap-2">
                      <div className="flex-1">
                        <div className="text-sm font-semibold text-ink-100">{item.title}</div>
                        <div className="text-xs text-ink-300">{item.description}</div>
                      </div>
                      {added
                        ? <CheckCircle2 size={14} className="shrink-0 text-emerald-600"/>
                        : <Plus size={14} className="shrink-0 text-brand-600"/>}
                    </div>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
