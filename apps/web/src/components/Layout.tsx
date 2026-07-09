import { NavLink, Outlet } from 'react-router-dom';
import {
  LayoutDashboard, Boxes, Warehouse, Store, Truck, ArrowLeftRight,
  ShieldCheck, LogOut, ShoppingCart, Wrench, ShieldAlert, FileBarChart,
  FileSearch, ClipboardCheck, Radar, KeyRound, Bell, Sparkles,
  UsersRound, LayoutTemplate, Printer, Upload, Activity, ShieldQuestion, Disc, Download,
} from 'lucide-react';
import clsx from 'clsx';
import { useAuth } from '@/store/auth';
import { FusionMark } from './FusionMark';

type Section = { label: string; items: { to: string; label: string; icon: any; end?: boolean }[] };

const sections: Section[] = [
  {
    label: 'Overview',
    items: [
      { to: '/',         label: 'Dashboard', icon: LayoutDashboard, end: true },
      { to: '/alerts',   label: 'Alerts',    icon: Bell },
    ],
  },
  {
    label: 'Inventory',
    items: [
      { to: '/assets',       label: 'Assets',         icon: Boxes },
      { to: '/assets/import',label: 'Bulk Import',    icon: Upload },
      { to: '/stock',        label: 'Stock',          icon: Warehouse },
      { to: '/discovery',    label: 'Discovery',      icon: Radar },
      { to: '/software',     label: 'Software',       icon: Disc },
    ],
  },
  {
    label: 'Logistics',
    items: [
      { to: '/grv',          label: 'GRV',          icon: Truck },
      { to: '/ibt',          label: 'IBT',          icon: ArrowLeftRight },
      { to: '/procurement',  label: 'Procurement',  icon: ShoppingCart },
      { to: '/invoices',     label: 'Invoices',     icon: FileSearch },
    ],
  },
  {
    label: 'Service',
    items: [
      { to: '/repairs',     label: 'Repairs',     icon: Wrench },
      { to: '/warranties',  label: 'Warranties',  icon: ShieldAlert },
    ],
  },
  {
    label: 'Toner',
    items: [
      { to: '/toner',        label: 'Dashboard',  icon: Printer, end: true },
      { to: '/toner/plan',   label: 'Annual Plan', icon: LayoutTemplate },
      { to: '/toner/orders', label: 'Orders',     icon: Truck },
      { to: '/toner/types',  label: 'Toner Types', icon: Boxes },
    ],
  },
  {
    label: 'Stores',
    items: [
      { to: '/stores',         label: 'Stores',           icon: Store },
      { to: '/audits',         label: 'Audits',           icon: ClipboardCheck },
      { to: '/stores/wizard',  label: 'New Store Wizard', icon: Sparkles },
    ],
  },
  {
    label: 'Admin',
    items: [
      { to: '/admin/users',     label: 'Users & Access',  icon: UsersRound },
      { to: '/admin/templates', label: 'Store Templates', icon: LayoutTemplate },
      { to: '/admin/skus',      label: 'SKUs & Pricing',  icon: Boxes },
      { to: '/admin/activity',  label: 'Activity Log',    icon: Activity },
      { to: '/admin/updates',   label: 'Updates',         icon: Download },
      { to: '/admin/security',  label: 'My Security (2FA)', icon: ShieldQuestion },
      { to: '/reports',         label: 'Reports',         icon: FileBarChart },
      { to: '/admin/api-keys',  label: 'API Keys',        icon: KeyRound },
    ],
  },
];

export function Layout() {
  const user = useAuth((s) => s.user);
  const logout = useAuth((s) => s.logout);

  return (
    <div className="grid h-full grid-cols-[270px_1fr]">
      <aside className="relative flex flex-col border-r border-ink-500/40 bg-sidebar-gradient">
        <div className="relative flex items-center justify-center px-4 py-6">
          <div className="absolute inset-0 bg-glow-brand opacity-60" />
          <FusionMark size="lg" className="relative" />
        </div>

        <div className="mx-3 mb-3 h-px bg-gradient-to-r from-transparent via-brand-500/30 to-transparent" />

        <nav className="flex-1 overflow-y-auto px-3 pb-4">
          {sections.map((sec, i) => (
            <div key={sec.label} className={clsx(i > 0 && 'mt-5')}>
              <div className="px-3 pb-1.5 text-[10px] font-bold uppercase tracking-[0.18em] text-ink-200/70">
                {sec.label}
              </div>
              {sec.items.map((n) => (
                <NavLink
                  key={n.to}
                  to={n.to}
                  end={n.end}
                  className={({ isActive }) =>
                    clsx(
                      'group relative mb-0.5 flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all',
                      isActive
                        ? 'bg-ink-700/80 text-white shadow-[inset_0_0_0_1px_rgba(254,102,32,0.4)]'
                        : 'text-ink-100 hover:bg-ink-700/40 hover:text-white',
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      <span className={clsx(
                        'absolute left-0 h-5 w-0.5 rounded-r-full transition-all',
                        isActive ? 'bg-brand-500 shadow-[0_0_6px_rgba(254,102,32,0.7)]' : 'bg-transparent group-hover:bg-brand-500/40',
                      )} />
                      <n.icon size={15} className={clsx(
                        'transition-colors',
                        isActive ? 'text-brand-400' : 'text-ink-200 group-hover:text-ink-50',
                      )}/>
                      {n.label}
                    </>
                  )}
                </NavLink>
              ))}
            </div>
          ))}
        </nav>

        <div className="m-3 mt-0 rounded-xl border border-ink-500/60 bg-ink-700/40 p-3">
          {user && (
            <div className="mb-2 flex items-center gap-2.5">
              <div className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-brand-400 to-brand-600 text-xs font-bold text-white shadow-[0_0_12px_rgba(254,102,32,0.4)]">
                {user.fullName.split(' ').map(p => p[0]).slice(0,2).join('')}
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

      <main className="relative overflow-y-auto">
        <div className="mx-auto max-w-7xl px-8 py-8">
          <Outlet />
        </div>
      </main>
    </div>
  );
}
