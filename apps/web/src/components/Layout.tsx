import { useEffect, useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  LayoutDashboard, Boxes, Warehouse, Store, Truck, ArrowLeftRight,
  ShieldCheck, LogOut, ShoppingCart, Wrench, ShieldAlert, FileBarChart,
  FileSearch, ClipboardCheck, Radar, KeyRound, Bell, Sparkles,
  UsersRound, LayoutTemplate, Printer, Upload, Activity, ShieldQuestion, Disc, Download,
  ChevronDown, Package,
} from 'lucide-react';
import clsx from 'clsx';
import { useAuth } from '@/store/auth';
import { api } from '@/api/client';
import { FusionMark } from './FusionMark';

type SingleItem  = { kind: 'single'; id: string; label: string; icon: any; to: string; end?: boolean };
type GroupItem   = { kind: 'group';  id: string; label: string; icon: any; items: { to: string; label: string; end?: boolean }[] };
type NavEntry    = SingleItem | GroupItem;

const NAV: NavEntry[] = [
  { kind: 'single', id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard, to: '/', end: true },
  { kind: 'single', id: 'alerts',    label: 'Alerts',    icon: Bell,            to: '/alerts' },

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

  { kind: 'group', id: 'toner', label: 'Toner', icon: Printer, items: [
    { to: '/toner',        label: 'Dashboard', end: true },
    { to: '/toner/plan',   label: 'Annual Plan' },
    { to: '/toner/orders', label: 'Orders' },
    { to: '/toner/types',  label: 'Toner Types' },
  ] },

  { kind: 'group', id: 'stores', label: 'Stores', icon: Store, items: [
    { to: '/stores',        label: 'Stores' },
    { to: '/audits',        label: 'Audits' },
    { to: '/stores/wizard', label: 'New Store Wizard' },
  ] },

  { kind: 'single', id: 'reports', label: 'Reports', icon: FileBarChart, to: '/reports' },

  { kind: 'group', id: 'admin', label: 'Admin', icon: ShieldCheck, items: [
    { to: '/admin/users',     label: 'Users & Access' },
    { to: '/admin/templates', label: 'Store Templates' },
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
    refetchInterval: 5 * 60_000,   // poll every 5 minutes
    staleTime: 60_000,
    retry: false,
  });
  return !!q.data?.available;
}

export function Layout() {
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);
  const location = useLocation();
  const updateAvailable = useUpdateBadge();

  // Which section is currently open (only one at a time)
  const [open, setOpen] = useState<string | null>(null);

  // Auto-open the section that contains the current route
  useEffect(() => {
    const match = NAV.find((n) => n.kind === 'group' && n.items.some((i) =>
      i.end ? location.pathname === i.to : location.pathname.startsWith(i.to),
    ));
    if (match) setOpen(match.id);
  }, [location.pathname]);

  return (
    <div className="grid h-full grid-cols-[280px_1fr]">
      {/* ---------- Sidebar ---------- */}
      <aside className="relative flex flex-col border-r border-ink-500/40 bg-sidebar-gradient">
        {/* Brand */}
        <div className="relative flex flex-col items-center px-4 py-6">
          <div className="absolute inset-0 bg-glow-brand opacity-60" />
          <FusionMark size="md" className="relative" />
          <div className="relative mt-3 text-[10px] font-bold uppercase tracking-[0.22em] text-ink-200">
            Operations Command Center
          </div>
        </div>

        <div className="mx-3 h-px bg-gradient-to-r from-transparent via-brand-500/30 to-transparent" />

        {/* Nav */}
        <nav className="flex-1 overflow-y-auto p-3">
          {NAV.map((entry) =>
            entry.kind === 'single'
              ? <SingleNav key={entry.id} entry={entry}
                           updateBadge={entry.id === 'admin' && updateAvailable} />
              : <GroupNav  key={entry.id} entry={entry}
                           isOpen={open === entry.id}
                           onToggle={() => setOpen(open === entry.id ? null : entry.id)}
                           updateBadge={entry.id === 'admin' && updateAvailable} />,
          )}
        </nav>

        {/* User card */}
        <div className="m-3 mt-0 rounded-xl border border-ink-500/60 bg-ink-700/40 p-3">
          {user && (
            <div className="mb-2 flex items-center gap-2.5">
              <div className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-brand-400 to-brand-600 text-xs font-bold text-white shadow-[0_0_12px_rgba(254,102,32,0.4)]">
                {user.fullName.split(' ').map((p: string) => p[0]).slice(0,2).join('')}
              </div>
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold text-white">{user.fullName}</div>
                <div className="truncate text-[11px] uppercase tracking-wider text-brand-400">{user.role.replaceAll('_',' ')}</div>
              </div>
            </div>
          )}
          <button onClick={logout} className="flex w-full items-center justify-center gap-2 rounded-md border border-ink-500/60 bg-ink-700/30 px-3 py-1.5 text-xs font-medium text-ink-100 hover:border-rose-500/40 hover:bg-rose-500/10 hover:text-rose-300 transition-colors">
            <LogOut size={13}/> Sign out
          </button>
        </div>
      </aside>

      {/* ---------- Main ---------- */}
      <main className="relative overflow-y-auto">
        {updateAvailable && (
          <div className="border-b border-brand-500/40 bg-brand-500/10 px-8 py-2 text-xs text-brand-300">
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

/* ---------------------------------------------------------------- */

function SingleNav({ entry, updateBadge }: { entry: SingleItem; updateBadge?: boolean }) {
  const Icon = entry.icon;
  return (
    <NavLink to={entry.to} end={entry.end}
      className={({ isActive }) => clsx(
        'group relative mb-1 flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm transition-all',
        isActive
          ? 'bg-gradient-to-r from-brand-500 to-brand-600 text-white shadow-[0_4px_14px_-4px_rgba(254,102,32,0.55)]'
          : 'text-ink-100 hover:bg-ink-700/50 hover:text-white',
      )}>
      {({ isActive }) => (
        <>
          <Icon size={16} className={isActive ? 'text-white' : 'text-ink-200 group-hover:text-white'} />
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
            ? 'bg-gradient-to-r from-brand-500 to-brand-600 text-white shadow-[0_4px_14px_-4px_rgba(254,102,32,0.55)]'
            : 'text-ink-100 hover:bg-ink-700/50 hover:text-white',
        )}
      >
        <Icon size={16} className={isOpen ? 'text-white' : 'text-ink-200 group-hover:text-white'} />
        <span className="flex-1 text-left">{entry.label}</span>
        {updateBadge && !isOpen && <UpdateDot />}
        <ChevronDown size={14}
          className={clsx('transition-transform', isOpen ? 'rotate-180' : '',
                          isOpen ? 'text-white' : 'text-ink-200')} />
      </button>

      <div
        className={clsx(
          'grid overflow-hidden transition-[grid-template-rows] duration-200 ease-out',
          isOpen ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]',
        )}
      >
        <div className="min-h-0">
          <div className="mt-1 space-y-0.5 rounded-lg bg-ink-700/30 py-1 pl-3 pr-1">
            {entry.items.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => clsx(
                  'relative flex items-center gap-2 rounded-md px-3 py-1.5 text-[13px] transition-colors',
                  isActive
                    ? 'bg-ink-600/70 font-medium text-white'
                    : 'text-ink-100 hover:bg-ink-600/40 hover:text-white',
                )}
              >
                {({ isActive }) => (
                  <>
                    <span className={clsx(
                      'ml-1 inline-block h-1 w-1 rounded-full transition-colors',
                      isActive ? 'bg-brand-400' : 'bg-ink-400/50',
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
    <span className="inline-flex h-2 w-2 items-center justify-center">
      <span className="absolute h-2 w-2 animate-ping rounded-full bg-brand-400 opacity-75" />
      <span className="relative h-2 w-2 rounded-full bg-brand-500 shadow-[0_0_8px_rgba(254,102,32,0.9)]" />
    </span>
  );
}
