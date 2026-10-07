import { useEffect, useMemo, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  LayoutDashboard, Boxes, Store, Truck, ShieldCheck, LogOut, Wrench,
  FileBarChart, Bell, Printer, ChevronDown, Package, MonitorSmartphone, Building2, LifeBuoy,
  ClipboardList, Monitor, Film, Terminal, ArrowDown, ArrowUp, Eye, EyeOff, Pencil, RotateCcw,
} from 'lucide-react';
import clsx from 'clsx';
import { useAuth } from '@/store/auth';
import { api } from '@/api/client';
import { FusionMark } from './FusionMark';
import { ForceChangePasswordModal } from './ForceChangePasswordModal';

type SingleItem  = { kind: 'single'; id: string; label: string; icon: any; to: string; end?: boolean };
type GroupItem   = { kind: 'group';  id: string; label: string; icon: any; items: { to: string; label: string; end?: boolean }[] };
type NavEntry    = SingleItem | GroupItem;

const NAV: NavEntry[] = [
  { kind: 'single', id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, to: '/', end: true },
  { kind: 'single', id: 'alerts',    label: 'Alerts',    icon: Bell,            to: '/alerts' },
  { kind: 'single', id: 'reminders', label: 'Reminders & Tasks', icon: ClipboardList, to: '/reminders' },
  { kind: 'group', id: 'hq', label: 'Head Office', icon: Building2, items: [
    { to: '/hq',             label: 'HQ Assets' },
    { to: '/hq/departments', label: 'HQ Departments' },
    { to: '/hq/agents',      label: 'HQ Agent Enrollment' },
  ] },

  { kind: 'group', id: 'inventory', label: 'Inventory', icon: Boxes, items: [
    { to: '/assets',       label: 'Assets' },
    { to: '/assets/import',label: 'Bulk Import' },
    { to: '/stock',        label: 'Stock' },
    { to: '/discovery',    label: 'Discovery' },
    { to: '/software',     label: 'Software' },
  ] },

  { kind: 'group', id: 'logistics', label: 'Logistics', icon: Truck, items: [
    { to: '/grv',         label: 'GRV' },
    { to: '/ibt',         label: 'IBT' },
    { to: '/procurement', label: 'Procurement' },
    { to: '/invoices',    label: 'Invoices' },
  ] },

  { kind: 'group', id: 'service', label: 'Service', icon: Wrench, items: [
    { to: '/repairs',    label: 'Repairs' },
    { to: '/warranties', label: 'Warranties' },
  ] },

  { kind: 'group', id: 'helpdesk', label: 'Helpdesk', icon: LifeBuoy, items: [
    { to: '/helpdesk',         label: 'Queue' },
    { to: '/helpdesk/new',     label: 'Log a call' },
    { to: '/helpdesk/reports', label: 'Reports' },
    { to: '/helpdesk/admin',   label: 'Configuration' },
  ] },

  { kind: 'group', id: 'toner', label: 'Toner', icon: Printer, items: [
    { to: '/toner',        label: 'Dashboard', end: true },
    { to: '/toner/plan',   label: 'Annual Plan' },
    { to: '/toner/orders', label: 'Orders' },
    { to: '/toner/types',  label: 'Toner Types' },
  ] },

  { kind: 'group', id: 'stores', label: 'Stores', icon: Store, items: [
    { to: '/stores',         label: 'Stores' },
    { to: '/regions',        label: 'Regions' },
    { to: '/area-managers',  label: 'Area Managers' },
    { to: '/audits',         label: 'Audits' },
    { to: '/stores/wizard',  label: 'New Store Wizard' },
    { to: '/mikrotik',       label: 'MikroTik Configs' },
    { to: '/stores/agents',  label: 'PC Agent Enrollment' },
    { to: '/stores/pinpads', label: 'PIN Pads (Nedbank)' },
    { to: '/stores/dvrs',    label: 'CCTV / DVRs' },
  ] },

  { kind: 'group', id: 'rmm', label: 'RMM', icon: Terminal, items: [
    { to: '/rmm',            label: 'Remote PCs' },
  ] },

  { kind: 'group', id: 'signage', label: 'Signage', icon: Film, items: [
    { to: '/signage/devices',   label: 'Media Players' },
    { to: '/signage/videos',    label: 'Videos' },
    { to: '/signage/playlists', label: 'Playlists' },
    { to: '/signage/install',   label: 'Install New Device' },
  ] },

  { kind: 'single', id: 'reports', label: 'Reports', icon: FileBarChart, to: '/reports' },

  { kind: 'group', id: 'admin', label: 'Admin', icon: ShieldCheck, items: [
    { to: '/admin/users',       label: 'Users & Access' },
    { to: '/admin/departments', label: 'HQ Departments' },
    { to: '/admin/templates',   label: 'Store Templates' },
    { to: '/admin/skus',      label: 'SKUs & Pricing' },
    { to: '/admin/activity',  label: 'Activity Log' },
    { to: '/admin/updates',   label: 'Updates' },
    { to: '/admin/security',  label: 'My Security' },
    { to: '/admin/api-keys',  label: 'API Keys' },
  ] },
];

function useUpdateBadge() {
  const q = useQuery({
    queryKey: ['update-status'],
    queryFn: () => api.get('/admin/updates/status').then((r) => r.data).catch(() => null),
    refetchInterval: 5 * 60_000,
    staleTime: 60_000,
    retry: false,
  });
  return !!q.data?.available;
}

type Pref = { itemId: string; position: number; isHidden: boolean };

export function Layout() {
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const location = useLocation();
  const qc = useQueryClient();
  const updateAvailable = useUpdateBadge();
  const [open, setOpen] = useState<string | null>(null);
  const [editMode, setEditMode] = useState(false);

  // Load per-user sidebar preferences (order + hide/show).
  const prefs = useQuery({
    queryKey: ['nav-prefs'],
    queryFn: () => api.get('/me/nav-preferences').then((r) => r.data as Pref[]).catch(() => [] as Pref[]),
    staleTime: 60_000,
  });

  // Compute the ordered + filtered NAV. Items without a preference row keep
  // their default order at the end.
  const orderedNav = useMemo(() => {
    const byId = new Map<string, Pref>((prefs.data ?? []).map((p) => [p.itemId, p]));
    const positioned = NAV.map((n, defaultIdx) => {
      const p = byId.get(n.id);
      return {
        entry: n,
        position: p ? p.position : NAV.length + defaultIdx,
        isHidden: p?.isHidden ?? false,
      };
    });
    positioned.sort((a, b) => a.position - b.position);
    return positioned;
  }, [prefs.data]);

  const savePrefs = useMutation({
    mutationFn: (items: Pref[]) => api.post('/me/nav-preferences', { items }).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['nav-prefs'] }),
  });
  const resetPrefs = useMutation({
    mutationFn: () => api.post('/me/nav-preferences/reset').then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['nav-prefs'] }),
  });

  function updatePref(itemId: string, patch: Partial<Pref>) {
    const current = orderedNav.map((o, i) => ({
      itemId: o.entry.id, position: i, isHidden: o.isHidden,
    }));
    const idx = current.findIndex((c) => c.itemId === itemId);
    if (idx >= 0) current[idx] = { ...current[idx], ...patch };
    savePrefs.mutate(current);
  }
  function moveItem(itemId: string, dir: -1 | 1) {
    const current = orderedNav.map((o, i) => ({
      itemId: o.entry.id, position: i, isHidden: o.isHidden,
    }));
    const idx = current.findIndex((c) => c.itemId === itemId);
    const target = idx + dir;
    if (idx < 0 || target < 0 || target >= current.length) return;
    [current[idx], current[target]] = [current[target], current[idx]];
    savePrefs.mutate(current.map((c, i) => ({ ...c, position: i })));
  }

  useEffect(() => {
    const match = NAV.find((n) => n.kind === 'group' && n.items.some((i) =>
      i.end ? location.pathname === i.to : location.pathname.startsWith(i.to),
    ));
    if (match) setOpen(match.id);
  }, [location.pathname]);

  return (
    <div className="grid h-full grid-cols-[280px_1fr] bg-white">
      <ForceChangePasswordModal />
      {/* ---------- Sidebar ---------- */}
      <aside className="relative flex flex-col border-r border-ink-500 bg-sidebar-gradient">
        {/* Brand */}
        <div className="relative flex flex-col items-center px-4 py-6">
          <div className="rounded-lg bg-[#0b0f1a] px-6 py-4">
            <FusionMark size="md" />
          </div>
          <div className="mt-3 text-[10px] font-bold uppercase tracking-[0.22em] text-ink-400">
            IT Command Center
          </div>
        </div>

        <div className="mx-3 h-px bg-ink-500" />

        {/* Nav — ordered by user preference, filtered by hide/show (unless editing) */}
        <nav className="flex-1 overflow-y-auto p-3">
          {orderedNav
            .filter((o) => editMode || !o.isHidden)
            .map((o, i, arr) => {
              const entry = o.entry;
              const inner = entry.kind === 'single'
                ? <SingleNav entry={entry} updateBadge={entry.id === 'admin' && updateAvailable} />
                : <GroupNav  entry={entry}
                             isOpen={open === entry.id}
                             onToggle={() => setOpen(open === entry.id ? null : entry.id)}
                             updateBadge={entry.id === 'admin' && updateAvailable} />;

              if (!editMode) return <div key={entry.id}>{inner}</div>;

              return (
                <div key={entry.id}
                  className={clsx(
                    'group relative mb-1 rounded-lg border transition-colors',
                    o.isHidden ? 'border-dashed border-ink-500/40 opacity-60' : 'border-transparent',
                  )}>
                  {/* Reorder & hide controls (visible only in edit mode) */}
                  <div className="pointer-events-none absolute -right-1 top-1 flex flex-col gap-0.5 opacity-80 group-hover:opacity-100">
                    <button type="button"
                      className="pointer-events-auto rounded bg-white/90 p-0.5 ring-1 ring-ink-500/30 hover:bg-brand-50"
                      disabled={i === 0}
                      title="Move up"
                      onClick={() => moveItem(entry.id, -1)}>
                      <ArrowUp size={10}/>
                    </button>
                    <button type="button"
                      className="pointer-events-auto rounded bg-white/90 p-0.5 ring-1 ring-ink-500/30 hover:bg-brand-50"
                      disabled={i === arr.length - 1}
                      title="Move down"
                      onClick={() => moveItem(entry.id, 1)}>
                      <ArrowDown size={10}/>
                    </button>
                    <button type="button"
                      className="pointer-events-auto rounded bg-white/90 p-0.5 ring-1 ring-ink-500/30 hover:bg-brand-50"
                      title={o.isHidden ? 'Show' : 'Hide'}
                      onClick={() => updatePref(entry.id, { isHidden: !o.isHidden })}>
                      {o.isHidden ? <EyeOff size={10}/> : <Eye size={10}/>}
                    </button>
                  </div>
                  {inner}
                </div>
              );
            })}
        </nav>

        {/* Sidebar editor controls */}
        <div className="mx-3 mb-2 flex items-center justify-between gap-1 text-[10px] text-ink-300">
          <button
            type="button"
            className={clsx(
              'flex items-center gap-1 rounded px-2 py-1 transition-colors',
              editMode ? 'bg-brand-500/10 text-brand-700 ring-1 ring-brand-400' : 'hover:bg-ink-500/5',
            )}
            onClick={() => setEditMode((v) => !v)}>
            <Pencil size={10}/>{editMode ? 'Done' : 'Customise'}
          </button>
          {editMode && (
            <button type="button" className="flex items-center gap-1 rounded px-2 py-1 hover:bg-ink-500/5"
              onClick={() => { if (confirm('Reset sidebar to default?')) resetPrefs.mutate(); }}>
              <RotateCcw size={10}/>Reset
            </button>
          )}
        </div>

        {/* User card */}
        <div className="m-3 mt-0 rounded-xl border border-ink-500 bg-white p-3">
          {user && (
            <div className="mb-2 flex items-center gap-2.5">
              <div className="grid h-9 w-9 place-items-center rounded-full bg-brand-500 text-xs font-bold text-white">
                {user.fullName.split(' ').map((p: string) => p[0]).slice(0,2).join('')}
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-ink-50">{user.fullName}</div>
                <div className="truncate text-[11px] uppercase tracking-wider text-brand-600">{user.role.replaceAll('_',' ')}</div>
              </div>
            </div>
          )}
          <button onClick={logout} className="flex w-full items-center justify-center gap-2 rounded-md border border-ink-500 bg-white px-3 py-1.5 text-xs font-medium text-ink-200 hover:border-rose-300 hover:bg-rose-50 hover:text-rose-700 transition-colors">
            <LogOut size={13}/> Sign out
          </button>
        </div>
      </aside>

      {/* ---------- Main ---------- */}
      <main className="relative overflow-y-auto bg-white">
        {updateAvailable && (
          <div className="border-b border-brand-200 bg-brand-50 px-8 py-2 text-xs text-brand-700">
            <NavLink to="/admin/updates" className="inline-flex items-center gap-2 hover:underline">
              <Package size={12}/> A new version is available — click here to review and install
            </NavLink>
          </div>
        )}
        <div className="mx-auto max-w-7xl px-8 py-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}

function SingleNav({ entry, updateBadge }: { entry: SingleItem; updateBadge?: boolean }) {
  const Icon = entry.icon;
  return (
    <NavLink to={entry.to} end={entry.end}
      className={({ isActive }) => clsx(
        'group relative mb-1 flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-all',
        isActive
          ? 'bg-brand-50 text-brand-700 font-medium'
          : 'text-ink-200 hover:bg-ink-600 hover:text-ink-50',
      )}>
      {({ isActive }) => (
        <>
          {isActive && <span className="absolute left-0 top-1.5 h-6 w-0.5 rounded-r-full bg-brand-500" />}
          <Icon size={16} className={isActive ? 'text-brand-600' : 'text-ink-300 group-hover:text-ink-100'} />
          <span className="flex-1">{entry.label}</span>
          {updateBadge && <UpdateDot />}
        </>
      )}
    </NavLink>
  );
}

function GroupNav({ entry, isOpen, onToggle, updateBadge }:
  { entry: GroupItem; isOpen: boolean; onToggle: () => void; updateBadge?: boolean }) {
  const Icon = entry.icon;
  return (
    <div className="mb-1">
      <button
        onClick={onToggle}
        className={clsx(
          'group flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-all',
          isOpen
            ? 'bg-brand-50 text-brand-700 font-medium'
            : 'text-ink-200 hover:bg-ink-600 hover:text-ink-50',
        )}
      >
        <Icon size={16} className={isOpen ? 'text-brand-600' : 'text-ink-300 group-hover:text-ink-100'} />
        <span className="flex-1 text-left">{entry.label}</span>
        {updateBadge && !isOpen && <UpdateDot />}
        <ChevronDown size={14}
          className={clsx('transition-transform', isOpen ? 'rotate-180' : '',
                          isOpen ? 'text-brand-600' : 'text-ink-400')} />
      </button>

      <div
        className={clsx(
          'grid overflow-hidden transition-[grid-template-rows] duration-200 ease-out',
          isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        )}
      >
        <div className="min-h-0">
          <div className="mt-1 space-y-0.5 py-1 pl-3 pr-1">
            {entry.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => clsx(
                  'relative flex items-center gap-2 rounded-md px-3 py-1.5 text-[13px] transition-colors',
                  isActive
                    ? 'bg-white font-medium text-ink-50 shadow-card'
                    : 'text-ink-200 hover:bg-white hover:text-ink-50',
                )}
              >
                {({ isActive }) => (
                  <>
                    <span className={clsx(
                      'ml-1 inline-block h-1 w-1 rounded-full transition-colors',
                      isActive ? 'bg-brand-500' : 'bg-ink-400',
                    )} />
                    <span className="flex-1">{item.label}</span>
                    {item.to === '/admin/updates' && updateBadge && <UpdateDot />}
                  </>
                )}
              </NavLink>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}

function UpdateDot() {
  return (
    <span className="relative inline-flex h-2 w-2 items-center justify-center">
      <span className="absolute h-2 w-2 animate-ping rounded-full bg-brand-400 opacity-75" />
      <span className="relative h-2 w-2 rounded-full bg-brand-500" />
    </span>
  );
}
