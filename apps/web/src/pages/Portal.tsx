/**
 * Store Portal.
 *
 * Simplified UI for STORE_MANAGER + AREA_MANAGER users. Four tiles:
 *   - My Open Calls         (ticket list, filterable Open / In Progress / Closed)
 *   - Log a Call            (new ticket form)
 *   - Log a Repair          (new repair form - item, fault, technician, waybill, dispatch)
 *   - My Asset Register     (read-only asset list)
 *
 * Area managers see data for every store they oversee; stores see only
 * their own. Scope is enforced server-side by /api/v1/portal/*.
 *
 * Deliberately NOT using the main Layout - this portal has its own header
 * and no nav rail so store staff can't stumble into admin pages.
 */
import { useState } from 'react';
import { Link, NavLink, Outlet, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Clipboard, LogOut, Phone, Plus, Package, Wrench,
  Home, FileText, Clock, CheckCircle2, AlertCircle,
} from 'lucide-react';
import { api } from '../api/client';
import { useAuth } from '../store/auth';

// =========================================================================
// Layout
// =========================================================================

export function PortalRoot() {
  return (
    <Routes>
      <Route element={<PortalLayout />}>
        <Route index                 element={<PortalHome />} />
        <Route path="calls"          element={<CallsList />} />
        <Route path="calls/new"      element={<CallNew />} />
        <Route path="calls/:id"      element={<CallDetail />} />
        <Route path="repairs"        element={<RepairsList />} />
        <Route path="repairs/new"    element={<RepairNew />} />
        <Route path="repairs/:id"    element={<RepairDetail />} />
        <Route path="assets"         element={<AssetsList />} />
      </Route>
    </Routes>
  );
}

function PortalLayout() {
  const me = useMe();
  const navigate = useNavigate();
  const logout = useAuth((s) => s.logout);

  return (
    <div className="min-h-screen bg-slate-50 text-ink-100">
      <header className="sticky top-0 z-20 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-3 shadow-sm">
        <Link to="/portal" className="flex items-center gap-2 font-semibold text-ink-100">
          <Clipboard size={18} className="text-amber-500" />
          <span>Store Portal</span>
        </Link>
        <div className="flex items-center gap-3 text-xs text-ink-300">
          {me.data && (
            <div className="hidden sm:flex flex-col items-end leading-tight">
              <span className="text-ink-100 font-medium">{me.data.fullName}</span>
              <span>
                {me.data.roleName}
                {me.data.stores?.length === 1 && ` - ${me.data.stores[0].code}`}
                {me.data.stores && me.data.stores.length > 1 && ` - ${me.data.stores.length} stores`}
              </span>
            </div>
          )}
          <button
            onClick={() => { logout(); navigate('/login'); }}
            className="flex items-center gap-1 rounded-md border border-slate-200 px-2 py-1 hover:bg-slate-50"
          >
            <LogOut size={12} />Sign out
          </button>
        </div>
      </header>
      <main className="mx-auto max-w-5xl p-4">
        <Outlet />
      </main>
    </div>
  );
}

// =========================================================================
// Home (tile dashboard)
// =========================================================================

function PortalHome() {
  const me = useMe();

  // Summary counts
  const openCalls   = useQuery({ queryKey: ['portal','tickets','open'],  queryFn: () => api.get('/portal/tickets?status=open').then(r => r.data) });
  const openRepairs = useQuery({ queryKey: ['portal','repairs','open'], queryFn: () => api.get('/portal/repairs?status=open').then(r => r.data) });

  return (
    <div className="space-y-4">
      <div className="rounded-lg bg-white p-4 shadow-sm">
        <h1 className="text-lg font-semibold">
          Welcome{me.data?.fullName ? `, ${me.data.fullName.split(' ')[0]}` : ''}
        </h1>
        <p className="mt-1 text-xs text-ink-300">
          {me.data?.stores?.length === 1
            ? `You are managing ${me.data.stores[0].name}.`
            : me.data?.stores?.length
              ? `You are overseeing ${me.data.stores.length} stores.`
              : 'Your portal scope will appear once an administrator sets you up.'}
        </p>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Tile
          to="/portal/calls" icon={<Phone size={20} />}
          label="My Open Calls" sub={`${openCalls.data?.length ?? '-'} open`}
          accent="bg-sky-50 text-sky-600"
        />
        <Tile
          to="/portal/calls/new" icon={<Plus size={20} />}
          label="Log a Call" sub="Report an IT issue"
          accent="bg-amber-50 text-amber-600"
        />
        <Tile
          to="/portal/repairs" icon={<Wrench size={20} />}
          label="Repairs in Progress" sub={`${openRepairs.data?.length ?? '-'} in progress`}
          accent="bg-rose-50 text-rose-600"
        />
        <Tile
          to="/portal/repairs/new" icon={<Plus size={20} />}
          label="Log a Repair" sub="Send equipment for repair"
          accent="bg-emerald-50 text-emerald-600"
        />
        <Tile
          to="/portal/assets" icon={<Package size={20} />}
          label="My Asset Register" sub="What IT equipment you have"
          accent="bg-violet-50 text-violet-600"
          wide
        />
      </div>
    </div>
  );
}

function Tile({
  to, icon, label, sub, accent, wide,
}: { to: string; icon: JSX.Element; label: string; sub: string; accent: string; wide?: boolean }) {
  return (
    <Link
      to={to}
      className={`group rounded-lg border border-slate-200 bg-white p-4 shadow-sm transition hover:border-slate-300 hover:shadow-md ${wide ? 'sm:col-span-2' : ''}`}
    >
      <div className="flex items-center gap-3">
        <div className={`flex h-10 w-10 items-center justify-center rounded-md ${accent}`}>{icon}</div>
        <div className="flex-1">
          <div className="font-semibold text-ink-100">{label}</div>
          <div className="text-xs text-ink-300">{sub}</div>
        </div>
      </div>
    </Link>
  );
}

// =========================================================================
// Calls (tickets)
// =========================================================================

function CallsList() {
  const [status, setStatus] = useState<'open'|'in_progress'|'closed'|'all'>('open');
  const q = useQuery({
    queryKey: ['portal','tickets',status],
    queryFn: () => api.get(`/portal/tickets?status=${status}`).then(r => r.data),
  });

  return (
    <div className="space-y-3">
      <PortalBreadcrumb back="/portal" title="Calls" action={
        <Link to="/portal/calls/new" className="rounded-md bg-amber-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-amber-600">
          <Plus size={12} className="mr-1 inline" />Log a Call
        </Link>
      } />

      <div className="flex gap-1 rounded-md bg-slate-100 p-1 text-xs">
        {(['open','in_progress','closed','all'] as const).map(s => (
          <button key={s}
            onClick={() => setStatus(s)}
            className={`flex-1 rounded px-3 py-1.5 ${status===s ? 'bg-white shadow font-medium text-ink-100' : 'text-ink-300'}`}
          >
            {s.replace('_',' ').replace(/\b\w/g, c => c.toUpperCase())}
          </button>
        ))}
      </div>

      <div className="divide-y divide-slate-100 rounded-lg bg-white shadow-sm">
        {q.data?.length ? q.data.map((t: any) => (
          <Link key={t.id} to={`/portal/calls/${t.id}`} className="flex items-center justify-between p-3 hover:bg-slate-50">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-sm font-medium">
                <span className="text-ink-300 text-[11px] font-mono">{t.code}</span>
                <span className="truncate">{t.subject}</span>
              </div>
              <div className="mt-0.5 text-[11px] text-ink-300">
                {t.store?.code} - {t.category?.name ?? 'No category'} - {new Date(t.createdAt).toLocaleDateString()}
              </div>
            </div>
            <StatusPill status={t.status} />
          </Link>
        )) : (
          <div className="p-6 text-center text-xs text-ink-300">
            {q.isLoading ? 'Loading…' : 'No calls in this view.'}
          </div>
        )}
      </div>
    </div>
  );
}

function CallNew() {
  const me = useMe();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [form, setForm] = useState({ storeId: '', subject: '', description: '', priority: 'MEDIUM' });

  // Auto-select the only store if the user has just one.
  if (me.data && me.data.stores?.length === 1 && !form.storeId) {
    setForm({ ...form, storeId: me.data.stores[0].id });
  }

  const create = useMutation({
    mutationFn: () => api.post('/portal/tickets', form).then(r => r.data),
    onSuccess: (t) => {
      qc.invalidateQueries({ queryKey: ['portal','tickets'] });
      navigate(`/portal/calls/${t.id}`);
    },
    onError: (e: any) => alert(e?.response?.data?.message ?? 'Failed to log call'),
  });

  return (
    <div className="space-y-3">
      <PortalBreadcrumb back="/portal/calls" title="Log a Call" />
      <form className="space-y-3 rounded-lg bg-white p-4 shadow-sm" onSubmit={(e) => { e.preventDefault(); create.mutate(); }}>
        {me.data && me.data.stores.length > 1 && (
          <Field label="Which store?">
            <select className="input w-full" value={form.storeId} onChange={e => setForm({ ...form, storeId: e.target.value })} required>
              <option value="">Select…</option>
              {me.data.stores.map((s: any) => <option key={s.id} value={s.id}>{s.code} - {s.name}</option>)}
            </select>
          </Field>
        )}
        <Field label="What's the issue? (one line)">
          <input className="input w-full" value={form.subject} onChange={e => setForm({ ...form, subject: e.target.value })} required maxLength={200} />
        </Field>
        <Field label="Details">
          <textarea className="input w-full" rows={5} value={form.description}
            onChange={e => setForm({ ...form, description: e.target.value })}
            placeholder="When did it start? What were you doing? Any error messages?" />
        </Field>
        <Field label="Priority">
          <select className="input w-full" value={form.priority} onChange={e => setForm({ ...form, priority: e.target.value })}>
            <option value="LOW">Low - minor annoyance, workaround exists</option>
            <option value="MEDIUM">Medium - affecting one person's work</option>
            <option value="HIGH">High - affecting a till or the whole store</option>
            <option value="CRITICAL">Critical - whole store down</option>
          </select>
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Link to="/portal/calls" className="btn-ghost">Cancel</Link>
          <button type="submit" className="btn-primary" disabled={create.isPending}>
            {create.isPending ? 'Logging…' : 'Log Call'}
          </button>
        </div>
      </form>
    </div>
  );
}

function CallDetail() {
  const { id } = useParams();
  const q = useQuery({
    queryKey: ['portal','ticket',id],
    queryFn: () => api.get(`/portal/tickets/${id}`).then(r => r.data),
  });

  if (q.isLoading) return <div className="p-6 text-center text-xs text-ink-300">Loading…</div>;
  if (!q.data)    return <div className="p-6 text-center text-xs text-ink-300">Not found.</div>;
  const t = q.data;

  return (
    <div className="space-y-3">
      <PortalBreadcrumb back="/portal/calls" title={`${t.code} - ${t.subject}`} />
      <div className="rounded-lg bg-white p-4 shadow-sm">
        <div className="flex items-center gap-3 text-xs">
          <StatusPill status={t.status} />
          <span className="text-ink-300">
            Logged {new Date(t.createdAt).toLocaleString()}
            {t.assignedTo && ` - assigned to ${t.assignedTo.fullName}`}
          </span>
        </div>
        <p className="mt-3 whitespace-pre-wrap text-sm">{t.description || <em className="text-ink-300">No description</em>}</p>
      </div>

      {t.comments?.length > 0 && (
        <div className="rounded-lg bg-white p-4 shadow-sm">
          <h3 className="mb-2 text-xs font-semibold text-ink-300">Updates from IT</h3>
          <div className="space-y-2">
            {t.comments.map((c: any) => (
              <div key={c.id} className="rounded bg-slate-50 p-2 text-xs">
                <div className="mb-1 flex justify-between text-ink-300">
                  <span className="font-medium text-ink-100">{c.author?.fullName ?? 'IT'}</span>
                  <span>{new Date(c.createdAt).toLocaleString()}</span>
                </div>
                <p className="whitespace-pre-wrap">{c.body}</p>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}

// =========================================================================
// Repairs
// =========================================================================

function RepairsList() {
  const [status, setStatus] = useState<'open'|'closed'|'all'>('open');
  const q = useQuery({
    queryKey: ['portal','repairs',status],
    queryFn: () => api.get(`/portal/repairs?status=${status}`).then(r => r.data),
  });

  return (
    <div className="space-y-3">
      <PortalBreadcrumb back="/portal" title="Repairs" action={
        <Link to="/portal/repairs/new" className="rounded-md bg-emerald-500 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-600">
          <Plus size={12} className="mr-1 inline" />Log a Repair
        </Link>
      } />

      <div className="flex gap-1 rounded-md bg-slate-100 p-1 text-xs">
        {(['open','closed','all'] as const).map(s => (
          <button key={s}
            onClick={() => setStatus(s)}
            className={`flex-1 rounded px-3 py-1.5 ${status===s ? 'bg-white shadow font-medium text-ink-100' : 'text-ink-300'}`}
          >
            {s === 'open' ? 'In Progress' : s[0].toUpperCase()+s.slice(1)}
          </button>
        ))}
      </div>

      <div className="divide-y divide-slate-100 rounded-lg bg-white shadow-sm">
        {q.data?.length ? q.data.map((r: any) => (
          <Link key={r.id} to={`/portal/repairs/${r.id}`} className="flex items-center justify-between p-3 hover:bg-slate-50">
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 text-sm font-medium">
                <span className="text-ink-300 text-[11px] font-mono">{r.code}</span>
                <span className="truncate">
                  {r.itemDescription || (r.asset?.assetNumber ? `Asset ${r.asset.assetNumber}` : 'Item')}
                </span>
              </div>
              <div className="mt-0.5 text-[11px] text-ink-300">
                {r.store?.code} - {r.faultDesc.slice(0, 60)}{r.faultDesc.length > 60 ? '…' : ''}
                {r.technicianName && ` - tech: ${r.technicianName}`}
                {r.waybillNumber && ` - WB ${r.waybillNumber}`}
              </div>
            </div>
            <StatusPill status={r.status} />
          </Link>
        )) : (
          <div className="p-6 text-center text-xs text-ink-300">
            {q.isLoading ? 'Loading…' : 'No repairs in this view.'}
          </div>
        )}
      </div>
    </div>
  );
}

function RepairNew() {
  const me = useMe();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [form, setForm] = useState({
    storeId: '',
    itemDescription: '',
    faultDesc: '',
    technicianName: '',
    waybillNumber: '',
    dispatchedDate: '',
  });

  if (me.data && me.data.stores?.length === 1 && !form.storeId) {
    setForm({ ...form, storeId: me.data.stores[0].id });
  }

  const create = useMutation({
    mutationFn: () => api.post('/portal/repairs', form).then(r => r.data),
    onSuccess: (r) => {
      qc.invalidateQueries({ queryKey: ['portal','repairs'] });
      navigate(`/portal/repairs/${r.id}`);
    },
    onError: (e: any) => alert(e?.response?.data?.message ?? 'Failed to log repair'),
  });

  return (
    <div className="space-y-3">
      <PortalBreadcrumb back="/portal/repairs" title="Log a Repair" />
      <form className="space-y-3 rounded-lg bg-white p-4 shadow-sm" onSubmit={e => { e.preventDefault(); create.mutate(); }}>
        {me.data && me.data.stores.length > 1 && (
          <Field label="Which store?">
            <select className="input w-full" value={form.storeId} onChange={e => setForm({ ...form, storeId: e.target.value })} required>
              <option value="">Select…</option>
              {me.data.stores.map((s: any) => <option key={s.id} value={s.id}>{s.code} - {s.name}</option>)}
            </select>
          </Field>
        )}
        <Field label="What's the item?" hint="e.g. 'Till 2 slip printer', 'Back office HP laptop'">
          <input className="input w-full" value={form.itemDescription} onChange={e => setForm({ ...form, itemDescription: e.target.value })} required maxLength={300} />
        </Field>
        <Field label="What's wrong with it?">
          <textarea className="input w-full" rows={4} value={form.faultDesc}
            onChange={e => setForm({ ...form, faultDesc: e.target.value })} required maxLength={2000}
            placeholder="Describe the fault, when it started, what you've already tried." />
        </Field>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Field label="Which technician collected it?" hint="Name of the person who picked it up">
            <input className="input w-full" value={form.technicianName} onChange={e => setForm({ ...form, technicianName: e.target.value })} maxLength={120} />
          </Field>
          <Field label="Waybill number" hint="If courier was used">
            <input className="input w-full" value={form.waybillNumber} onChange={e => setForm({ ...form, waybillNumber: e.target.value })} maxLength={80} />
          </Field>
        </div>
        <Field label="Dispatched date" hint="When did it leave the store? Leave blank if not yet sent.">
          <input type="date" className="input w-full sm:w-64"
            value={form.dispatchedDate} onChange={e => setForm({ ...form, dispatchedDate: e.target.value })} />
        </Field>
        <div className="flex justify-end gap-2 pt-2">
          <Link to="/portal/repairs" className="btn-ghost">Cancel</Link>
          <button type="submit" className="btn-primary" disabled={create.isPending}>
            {create.isPending ? 'Logging…' : 'Log Repair'}
          </button>
        </div>
      </form>
    </div>
  );
}

function RepairDetail() {
  const { id } = useParams();
  const qc = useQueryClient();
  const q = useQuery({
    queryKey: ['portal','repair',id],
    queryFn: () => api.get('/portal/repairs?status=all').then(r => r.data.find((x: any) => x.id === id)),
  });

  const upd = useMutation({
    mutationFn: (patch: any) => api.patch(`/portal/repairs/${id}`, patch).then(r => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['portal'] }),
  });

  if (q.isLoading) return <div className="p-6 text-center text-xs text-ink-300">Loading…</div>;
  if (!q.data)    return <div className="p-6 text-center text-xs text-ink-300">Not found.</div>;
  const r = q.data;

  return (
    <div className="space-y-3">
      <PortalBreadcrumb back="/portal/repairs" title={`${r.code} - ${r.itemDescription ?? 'Repair'}`} />
      <div className="rounded-lg bg-white p-4 shadow-sm">
        <div className="flex items-center gap-3 text-xs">
          <StatusPill status={r.status} />
          <span className="text-ink-300">Logged {new Date(r.createdAt).toLocaleString()}</span>
        </div>
        <dl className="mt-3 grid grid-cols-1 gap-x-4 gap-y-2 text-sm sm:grid-cols-2">
          <Row label="Store" v={r.store?.code ?? '-'} />
          <Row label="Status" v={prettyStatus(r.status)} />
          <Row label="Item" v={r.itemDescription ?? (r.asset?.assetNumber ?? '-')} />
          <Row label="Fault" v={r.faultDesc} />
          <Row label="Technician" v={r.technicianName ?? '-'} />
          <Row label="Waybill" v={r.waybillNumber ?? '-'} />
          <Row label="Dispatched" v={r.dispatchedDate ? new Date(r.dispatchedDate).toLocaleDateString() : '-'} />
          <Row label="Returned" v={r.returnedDate ? new Date(r.returnedDate).toLocaleDateString() : '-'} />
        </dl>
        <div className="mt-4 flex gap-2">
          {!r.returnedDate && r.status !== 'RETURNED' && (
            <button className="btn-primary"
              onClick={() => upd.mutate({ returnedDate: new Date().toISOString(), status: 'RETURNED' })}>
              Mark as Returned
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// =========================================================================
// Assets
// =========================================================================

function AssetsList() {
  const [search, setSearch] = useState('');
  const q = useQuery({
    queryKey: ['portal','assets',search],
    queryFn: () => api.get(`/portal/assets${search ? `?search=${encodeURIComponent(search)}` : ''}`).then(r => r.data),
  });

  // Group by category for readability
  const grouped: Record<string, any[]> = {};
  for (const a of q.data ?? []) {
    const k = a.category?.name ?? 'Other';
    (grouped[k] ??= []).push(a);
  }

  return (
    <div className="space-y-3">
      <PortalBreadcrumb back="/portal" title="My Asset Register" />

      <input
        className="input w-full"
        placeholder="Search by asset number, serial, model…"
        value={search} onChange={e => setSearch(e.target.value)}
      />

      {q.isLoading && <div className="p-6 text-center text-xs text-ink-300">Loading…</div>}
      {!q.isLoading && !q.data?.length && (
        <div className="rounded-lg bg-white p-6 text-center text-xs text-ink-300 shadow-sm">
          No assets found.
        </div>
      )}

      {Object.entries(grouped).map(([cat, items]) => (
        <div key={cat} className="rounded-lg bg-white shadow-sm">
          <div className="border-b border-slate-100 bg-slate-50 px-3 py-2 text-xs font-semibold text-ink-300">
            {cat} <span className="text-ink-300 font-normal">({items.length})</span>
          </div>
          <div className="divide-y divide-slate-100">
            {items.map(a => (
              <div key={a.id} className="grid grid-cols-1 gap-1 px-3 py-2 text-xs sm:grid-cols-5 sm:items-center">
                <div className="font-mono text-[11px] text-ink-300">{a.assetNumber ?? a.code}</div>
                <div className="font-medium text-ink-100">{a.manufacturer} {a.model}</div>
                <div className="text-ink-300">SN: {a.serialNumber ?? '-'}</div>
                <div className="text-ink-300">{a.store?.code}</div>
                <div><StatusPill status={a.status} /></div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// =========================================================================
// Helpers
// =========================================================================

function useMe() {
  return useQuery<{
    userId: string; fullName: string; email: string;
    role: string; roleName: string;
    stores: any[]; isMultiStore: boolean;
  }>({
    queryKey: ['portal','me'],
    queryFn: () => api.get('/portal/me').then(r => r.data),
    staleTime: 60_000,
  });
}

function PortalBreadcrumb({ back, title, action }: { back: string; title: string; action?: JSX.Element }) {
  return (
    <div className="flex items-center justify-between">
      <Link to={back} className="flex items-center gap-1 text-xs text-ink-300 hover:text-ink-100">
        <ArrowLeft size={12} />Back
      </Link>
      <h1 className="truncate text-sm font-semibold">{title}</h1>
      <div>{action}</div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: JSX.Element }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-medium text-ink-100">{label}</span>
      {hint && <span className="block text-[11px] text-ink-300">{hint}</span>}
      {children}
    </label>
  );
}

function Row({ label, v }: { label: string; v: string }) {
  return (
    <div className="flex gap-2">
      <dt className="w-24 shrink-0 text-ink-300">{label}:</dt>
      <dd className="min-w-0 flex-1 break-words text-ink-100">{v}</dd>
    </div>
  );
}

function StatusPill({ status }: { status: string }) {
  const map: Record<string, string> = {
    OPEN:        'bg-sky-50 text-sky-700 border-sky-200',
    NEW:         'bg-sky-50 text-sky-700 border-sky-200',
    IN_PROGRESS: 'bg-amber-50 text-amber-700 border-amber-200',
    ON_HOLD:     'bg-amber-50 text-amber-700 border-amber-200',
    WAITING:     'bg-amber-50 text-amber-700 border-amber-200',
    RESOLVED:    'bg-emerald-50 text-emerald-700 border-emerald-200',
    CLOSED:      'bg-slate-50 text-slate-500 border-slate-200',
    LOGGED:      'bg-sky-50 text-sky-700 border-sky-200',
    COLLECTED:   'bg-amber-50 text-amber-700 border-amber-200',
    AT_SUPPLIER: 'bg-amber-50 text-amber-700 border-amber-200',
    REPAIRED:    'bg-emerald-50 text-emerald-700 border-emerald-200',
    RETURNED:    'bg-emerald-50 text-emerald-700 border-emerald-200',
    REPLACED:    'bg-emerald-50 text-emerald-700 border-emerald-200',
    WRITTEN_OFF: 'bg-rose-50 text-rose-700 border-rose-200',
    CANCELLED:   'bg-slate-50 text-slate-500 border-slate-200',
  };
  return (
    <span className={`rounded border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wide ${map[status] ?? 'bg-slate-50 text-slate-500 border-slate-200'}`}>
      {prettyStatus(status)}
    </span>
  );
}

function prettyStatus(s: string) {
  return s.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}
