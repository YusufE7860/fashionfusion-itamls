/**
 * Store Portal.
 *
 * Dashboard-style UI for STORE_MANAGER + AREA_MANAGER users. The home page
 * is a widget grid:
 *   - KPI strip  (Open Calls / In Progress / Open Repairs)
 *   - Your IT Contact (currently-assigned tech with presence dot + phone/email,
 *                      or the weekend on-call tech when applicable)
 *   - Recent Calls      (cards with date on left, status middle, tech chip right)
 *   - Quick Actions     (Log Call / Log Repair / Asset Register)
 *
 * All data comes from /api/v1/portal/* and is scoped server-side by role.
 */
import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, Route, Routes, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Clipboard, LogOut, Plus, Package, Wrench, Phone, Mail,
  Clock, TrendingUp, AlertCircle, CheckCircle2, MessageSquare, Calendar,
  ChevronRight, Shield, User as UserIcon, Moon, Sun, Sparkles,
  Printer, Wifi, Monitor, Camera, CreditCard, ScanBarcode, HardDrive,
  BadgeDollarSign, FileText, Mail as MailIcon, HelpCircle,
} from 'lucide-react';
import { api } from '../api/client';
import { useAuth } from '../store/auth';
import { useTheme } from '../store/theme';
import { SkeletonList, SkeletonCard, IconBadge } from '../components/portal/Skeleton';

// =========================================================================
// Routes + Layout
// =========================================================================

export function PortalRoot() {
  return (
    <Routes>
      <Route element={<PortalLayout />}>
        <Route index                 element={<PortalHome />} />
        <Route path="calls"          element={<CallsList />} />
        <Route path="calls/new"      element={<CallNew />} />
        <Route path="calls/:id"      element={<CallDetail />} />
        {/* Repairs are now read-only for stores. The tech creates them from
            a ticket; the store only tracks progress. */}
        <Route path="repairs"        element={<RepairsList />} />
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
  const theme = useTheme();

  // Flip the .dark class on <html> so Tailwind's dark: variants kick in.
  // Also persist it (theme store already does), so refresh keeps the choice.
  useEffect(() => {
    const el = document.documentElement;
    if (theme.mode === 'dark') el.classList.add('dark');
    else                        el.classList.remove('dark');
    return () => { /* don't strip on unmount - other pages share <html> */ };
  }, [theme.mode]);

  return (
    <div className="min-h-screen bg-gradient-to-b from-slate-50 to-slate-100 text-slate-800 transition-colors
                    dark:from-slate-950 dark:to-slate-900 dark:text-slate-100">
      <header className="sticky top-0 z-20 border-b border-slate-200/70 bg-white/85 backdrop-blur-md
                         dark:border-slate-800/70 dark:bg-slate-900/80">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-4 py-3">
          <Link to="/portal" className="flex items-center gap-2.5">
            <div className="flex h-9 w-9 items-center justify-center rounded-xl bg-gradient-to-br from-brand-400 to-brand-600 text-white shadow-lg shadow-brand-500/30">
              <Sparkles size={16}/>
            </div>
            <div className="leading-tight">
              <div className="font-display text-sm font-bold text-slate-900 dark:text-white">Store Portal</div>
              <div className="text-[10px] font-medium uppercase tracking-[0.12em] text-slate-400 dark:text-slate-500">Fashion Fusion IT</div>
            </div>
          </Link>
          <nav className="hidden items-center gap-1 rounded-full bg-slate-100/70 p-1 text-xs font-medium backdrop-blur sm:flex
                           dark:bg-slate-800/70">
            {[
              ['/portal',          'Home'],
              ['/portal/calls',    'Calls'],
              ['/portal/repairs',  'Repairs'],
              ['/portal/assets',   'Assets'],
            ].map(([to, label]) => (
              <NavLink key={to} to={to} end={to === '/portal'}
                className={({isActive}) => `rounded-full px-3.5 py-1.5 transition-all ${
                  isActive
                    ? 'bg-white text-slate-900 shadow dark:bg-slate-700 dark:text-white'
                    : 'text-slate-500 hover:text-slate-900 dark:text-slate-400 dark:hover:text-white'
                }`}
              >{label}</NavLink>
            ))}
          </nav>
          <div className="flex items-center gap-2 text-xs">
            {me.data && (
              <div className="hidden text-right leading-tight sm:block">
                <div className="font-semibold text-slate-800 dark:text-white">{me.data.fullName}</div>
                <div className="text-slate-400 dark:text-slate-500">
                  {me.data.stores?.length === 1
                    ? me.data.stores[0].code
                    : me.data.stores?.length
                      ? `${me.data.stores.length} stores`
                      : me.data.roleName}
                </div>
              </div>
            )}
            <button
              onClick={theme.toggle}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 hover:text-slate-800
                         dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-white"
              title={theme.mode === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
            >
              {theme.mode === 'dark' ? <Sun size={13}/> : <Moon size={13}/>}
            </button>
            <button
              onClick={() => { logout(); navigate('/login'); }}
              className="flex h-8 w-8 items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-500 transition hover:bg-slate-50 hover:text-rose-600
                         dark:border-slate-700 dark:bg-slate-800 dark:text-slate-400 dark:hover:bg-slate-700 dark:hover:text-rose-400"
              title="Sign out"
            >
              <LogOut size={13}/>
            </button>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-7xl p-4">
        <Outlet />
      </main>
    </div>
  );
}

// =========================================================================
// Home — widget dashboard
// =========================================================================

function PortalHome() {
  const me        = useMe();
  const openCalls = useQuery({ queryKey: ['portal','tickets','open'],      queryFn: () => api.get('/portal/tickets?status=open').then(r => r.data) });
  const inProg    = useQuery({ queryKey: ['portal','tickets','in_progress'], queryFn: () => api.get('/portal/tickets?status=in_progress').then(r => r.data) });
  const openReps  = useQuery({ queryKey: ['portal','repairs','open'],      queryFn: () => api.get('/portal/repairs?status=open').then(r => r.data) });

  const recentCalls = [...(openCalls.data ?? []), ...(inProg.data ?? [])]
    .sort((a,b) => +new Date(b.updatedAt) - +new Date(a.updatedAt))
    .slice(0, 5);

  return (
    <div className="space-y-4">
      {/* ---- Welcome card: soft brand tint, light & airy ---- */}
      <div className="relative overflow-hidden rounded-2xl border border-slate-200/70 bg-gradient-to-br from-brand-50 via-white to-amber-50 p-6 shadow-sm
                      dark:border-slate-800 dark:from-slate-900 dark:via-slate-900 dark:to-slate-800">
        {/* Decorative blob */}
        <div className="pointer-events-none absolute -right-20 -top-20 h-64 w-64 rounded-full bg-brand-200/40 blur-3xl dark:bg-brand-900/20" />
        <div className="relative flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-[0.14em] text-brand-600 dark:text-brand-400">
              {greeting()}
            </div>
            <h1 className="mt-1 font-display text-3xl font-bold text-slate-900 dark:text-white">
              {me.data?.fullName?.split(' ')[0] ?? 'there'}<span className="text-brand-500">.</span>
            </h1>
            <p className="mt-1.5 max-w-lg text-sm text-slate-600 dark:text-slate-400">
              {me.data?.stores?.length === 1
                ? `Here's what's happening at ${me.data.stores[0].name}.`
                : me.data?.stores?.length
                  ? `Here's a summary across your ${me.data.stores.length} stores.`
                  : 'Your access will appear once an administrator sets you up.'}
            </p>
          </div>
          <div className="flex gap-2">
            <Link to="/portal/calls/new"
              className="group inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-5 py-2.5 text-sm font-semibold text-white shadow-lg shadow-slate-900/20 transition hover:-translate-y-0.5 hover:shadow-xl
                         dark:bg-brand-500 dark:shadow-brand-500/30 dark:hover:bg-brand-400">
              <Plus size={15} className="transition group-hover:rotate-90"/>Log a Call
            </Link>
          </div>
        </div>
      </div>

      {/* ---- KPI tiles ---- */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi label="Open Calls"      value={openCalls.data?.length ?? '-'} icon={<MessageSquare size={18}/>} tone="sky" />
        <Kpi label="In Progress"     value={inProg.data?.length ?? '-'}    icon={<Clock size={18}/>}        tone="amber" />
        <Kpi label="Repairs Open"    value={openReps.data?.length ?? '-'}  icon={<Wrench size={18}/>}       tone="rose" />
        <Kpi label="Stores Covered"  value={me.data?.stores?.length ?? '-'} icon={<Shield size={18}/>}      tone="violet" />
      </div>

      {/* ---- Main grid: Recent Calls | IT Contact ---- */}
      <div className="grid gap-3 lg:grid-cols-3">
        <section className="lg:col-span-2 space-y-3">
          <WidgetHeader title="Recent Calls" to="/portal/calls" />
          {openCalls.isLoading ? <SkeletonList count={2}/> :
            recentCalls.length
              ? recentCalls.map((t: any) => <CallCard key={t.id} t={t} />)
              : <EmptyMessage emoji="✨" title="All quiet — nothing broken today." hint="If something goes wrong, tap Log a Call. We'll be in touch quickly."/>}
        </section>

        <aside className="space-y-3">
          <WidgetHeader title="Your IT Contact" />
          <ITContact me={me.data} ticket={recentCalls[0]} />
          <WidgetHeader title="Shortcuts" />
          <div className="rounded-xl border border-slate-200/70 bg-white p-2 shadow-sm dark:border-slate-800 dark:bg-slate-900">
            <Shortcut to="/portal/calls"     icon={<MessageSquare size={14}/>} label="All my calls" />
            <Shortcut to="/portal/repairs"   icon={<Wrench size={14}/>}        label="Repairs register" />
            <Shortcut to="/portal/assets"    icon={<Package size={14}/>}       label="My IT equipment" />
          </div>
        </aside>
      </div>
    </div>
  );
}

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
}

// =========================================================================
// Reusable widget pieces
// =========================================================================

function Kpi({ label, value, icon, tone }: {
  label: string; value: number | string; icon: JSX.Element;
  tone: 'sky'|'amber'|'rose'|'violet';
}) {
  const bg = {
    sky:    'bg-sky-50    text-sky-600    dark:bg-sky-900/40    dark:text-sky-300',
    amber:  'bg-amber-50  text-amber-600  dark:bg-amber-900/40  dark:text-amber-300',
    rose:   'bg-rose-50   text-rose-600   dark:bg-rose-900/40   dark:text-rose-300',
    violet: 'bg-violet-50 text-violet-600 dark:bg-violet-900/40 dark:text-violet-300',
  }[tone];
  return (
    <div className="group rounded-xl border border-slate-200/70 bg-white p-4 shadow-sm transition
                     hover:-translate-y-0.5 hover:shadow-md
                     dark:border-slate-800 dark:bg-slate-900">
      <div className="flex items-center justify-between">
        <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400">{label}</span>
        <span className={`flex h-9 w-9 items-center justify-center rounded-xl transition group-hover:scale-110 ${bg}`}>{icon}</span>
      </div>
      <div className="mt-2 font-display text-3xl font-bold text-slate-900 dark:text-white">{value}</div>
    </div>
  );
}

function WidgetHeader({ title, to }: { title: string; to?: string }) {
  return (
    <div className="flex items-end justify-between">
      <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">{title}</h2>
      {to && <Link to={to} className="flex items-center gap-0.5 text-[11px] text-slate-500 hover:text-slate-900">View all <ChevronRight size={12}/></Link>}
    </div>
  );
}

function EmptyCard({ children }: { children: React.ReactNode }) {
  return (
    <div className="rounded-xl border border-dashed border-slate-200 bg-white p-6 text-center text-xs text-slate-400
                     dark:border-slate-700 dark:bg-slate-900 dark:text-slate-500">
      {children}
    </div>
  );
}

/** Warm, illustrated empty state used throughout the portal. */
function EmptyMessage({ emoji, title, hint }: { emoji: string; title: string; hint?: string }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-2xl border border-dashed border-slate-200 bg-white/70 p-8 text-center
                     dark:border-slate-700 dark:bg-slate-900/60">
      <div className="text-4xl leading-none select-none">{emoji}</div>
      <div className="text-sm font-semibold text-slate-700 dark:text-slate-200">{title}</div>
      {hint && <div className="max-w-xs text-xs text-slate-400 dark:text-slate-500">{hint}</div>}
    </div>
  );
}

function Shortcut({ to, icon, label }: { to: string; icon: JSX.Element; label: string }) {
  return (
    <Link to={to} className="group flex items-center justify-between rounded-lg px-3 py-2 text-sm text-slate-700 transition hover:bg-slate-50
                             dark:text-slate-300 dark:hover:bg-slate-800">
      <span className="flex items-center gap-2">{icon}{label}</span>
      <ChevronRight size={14} className="text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-slate-500 dark:text-slate-600 dark:group-hover:text-slate-400"/>
    </Link>
  );
}

// =========================================================================
// Call card — the headline component on the dashboard
// =========================================================================

function CallCard({ t }: { t: any }) {
  const d = new Date(t.createdAt);
  // Left-edge priority stripe - scannable from the other side of the room.
  const stripe = {
    P1: 'before:bg-rose-500',
    P2: 'before:bg-amber-500',
    P3: 'before:bg-sky-500',
    P4: 'before:bg-slate-300 dark:before:bg-slate-600',
  }[t.priority as string] ?? 'before:bg-slate-300';

  return (
    <Link to={`/portal/calls/${t.id}`}
      className={`relative block overflow-hidden rounded-xl border border-slate-200/70 bg-white shadow-sm transition
                   hover:-translate-y-0.5 hover:shadow-lg
                   dark:border-slate-800 dark:bg-slate-900
                   before:absolute before:left-0 before:top-0 before:h-full before:w-1 ${stripe}`}>
      <div className="flex">
        {/* Date gutter */}
        <div className="flex w-16 flex-col items-center justify-center border-r border-slate-100 bg-slate-50/70 py-3 text-slate-600
                         dark:border-slate-800 dark:bg-slate-900/60 dark:text-slate-400">
          <div className="text-[10px] font-semibold uppercase tracking-wider">{d.toLocaleString('en', { month: 'short' })}</div>
          <div className="font-display text-2xl font-bold leading-none text-slate-900 dark:text-white">{d.getDate()}</div>
          <div className="mt-0.5 text-[10px] text-slate-400 dark:text-slate-500">{d.toLocaleTimeString('en', { hour: '2-digit', minute: '2-digit' })}</div>
        </div>
        {/* Body */}
        <div className="min-w-0 flex-1 p-3">
          <div className="flex min-w-0 items-start justify-between gap-2">
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-1.5">
                <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-500 dark:bg-slate-800 dark:text-slate-400">{t.code}</span>
                <StatusPill status={t.status} />
                <PriorityPill priority={t.priority} />
              </div>
              <div className="mt-1.5 truncate text-sm font-semibold text-slate-900 dark:text-white">{t.subject}</div>
              <div className="mt-0.5 text-[11px] text-slate-400 dark:text-slate-500">
                {t.store?.code} · {t.category?.name ?? 'General'}
              </div>
              {t.lastUpdate && (
                <div className="mt-2 rounded-lg border-l-2 border-sky-400 bg-sky-50 p-2 text-[11px] text-slate-700
                                dark:border-sky-500 dark:bg-sky-950/40 dark:text-slate-200">
                  <span className="mr-1 font-semibold text-sky-700 dark:text-sky-300">{t.lastUpdate.author?.fullName ?? 'IT'}:</span>
                  <span className="line-clamp-1">{t.lastUpdate.body}</span>
                </div>
              )}
            </div>
          </div>
        </div>
        {/* Assigned tech chip */}
        {t.assignedTo ? (
          <div className="hidden w-44 flex-col items-center justify-center border-l border-slate-100 bg-slate-50/70 p-2 text-center sm:flex
                           dark:border-slate-800 dark:bg-slate-900/60">
            <PresenceAvatar u={t.assignedTo} size="sm" />
            <div className="mt-1 max-w-full truncate text-[11px] font-semibold text-slate-700 dark:text-slate-300">{t.assignedTo.fullName}</div>
            <div className="text-[10px] text-slate-400 dark:text-slate-500">{t.assignedTo.roleName ?? 'IT'}</div>
            {t.assignedTo.phone && (
              <a href={`tel:${t.assignedTo.phone}`} onClick={e => e.stopPropagation()}
                className="mt-1 flex items-center gap-1 text-[10px] font-medium text-sky-600 hover:underline dark:text-sky-400">
                <Phone size={10}/>{t.assignedTo.phone}
              </a>
            )}
          </div>
        ) : (
          <div className="hidden w-44 flex-col items-center justify-center border-l border-slate-100 bg-amber-50/70 p-2 text-center sm:flex
                           dark:border-slate-800 dark:bg-amber-950/30">
            <AlertCircle size={18} className="text-amber-500"/>
            <div className="mt-1 text-[11px] font-semibold text-amber-700 dark:text-amber-400">Awaiting assignment</div>
          </div>
        )}
      </div>
    </Link>
  );
}

// =========================================================================
// IT Contact widget (right rail on home)
// =========================================================================

function ITContact({ me, ticket }: { me: any; ticket: any }) {
  // Resolution order:
  //   1. Assigned tech on the most-recent open ticket  (badge ASSIGNED)
  //   2. Weekend on-call technician (Sat/Sun only)     (badge ON-CALL)
  //   3. Default IT contact for the store's area       (badge YOUR IT)
  // The widget should never be empty - the store always has someone to reach.
  const assigned       = ticket?.assignedTo;
  const onCall         = me?.onCall;
  const defaultContact = me?.defaultContact;

  const primary =
    assigned
      ? { ...assigned, badge: 'ASSIGNED' }
      : onCall
        ? { ...onCall, badge: 'ON-CALL', roleName: onCall.notes ?? 'Weekend On-Call' }
        : defaultContact
          ? { ...defaultContact, badge: 'YOUR IT' }
          : null;

  if (!primary) {
    return (
      <div className="rounded-xl bg-white p-5 text-center text-xs text-slate-400 shadow-sm">
        <UserIcon size={24} className="mx-auto mb-2 text-slate-300"/>
        No IT contact assigned to your area yet. Ask your admin to set one.
      </div>
    );
  }

  return (
    <div className="rounded-xl bg-white p-4 shadow-sm">
      <div className="flex items-center gap-3">
        <PresenceAvatar u={primary} size="lg" />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate text-sm font-semibold text-slate-900">{primary.fullName}</span>
            <span className="rounded bg-slate-100 px-1.5 py-0.5 text-[9px] font-bold uppercase text-slate-500">{primary.badge}</span>
          </div>
          <div className="truncate text-xs text-slate-400">{primary.roleName ?? 'IT'}</div>
          <PresenceLabel presence={primary.presence} />
        </div>
      </div>
      <div className="mt-3 grid grid-cols-2 gap-2">
        {primary.phone ? (
          <a href={`tel:${primary.phone}`} className="flex items-center justify-center gap-1 rounded-md border border-slate-200 bg-slate-50 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100">
            <Phone size={12}/>Call
          </a>
        ) : <div className="rounded-md border border-dashed border-slate-200 py-2 text-center text-[10px] text-slate-400">No phone on file</div>}
        {primary.email && (
          <a href={`mailto:${primary.email}`} className="flex items-center justify-center gap-1 rounded-md border border-slate-200 bg-slate-50 py-2 text-xs font-medium text-slate-700 hover:bg-slate-100">
            <Mail size={12}/>Email
          </a>
        )}
      </div>
      {onCall && primary.badge === 'ON-CALL' && onCall.until && (
        <div className="mt-2 flex items-center gap-1 text-[10px] text-slate-400">
          <Calendar size={10}/>On-call until {new Date(onCall.until).toLocaleString('en', { weekday: 'short', hour: '2-digit', minute: '2-digit' })}
        </div>
      )}
    </div>
  );
}

// =========================================================================
// Presence components
// =========================================================================

function PresenceAvatar({ u, size = 'md' }: { u: { fullName: string; presence?: string }; size?: 'sm'|'md'|'lg' }) {
  const dim = size === 'lg' ? 'h-12 w-12 text-base' : size === 'sm' ? 'h-8 w-8 text-[10px]' : 'h-10 w-10 text-xs';
  const dot = size === 'lg' ? 'h-3.5 w-3.5 right-0 bottom-0' : size === 'sm' ? 'h-2.5 w-2.5 -right-0.5 -bottom-0.5' : 'h-3 w-3 right-0 bottom-0';
  const initials = u.fullName.split(' ').slice(0,2).map(s => s[0]).join('').toUpperCase();
  const presenceColor = {
    AVAILABLE: 'bg-emerald-500 ring-emerald-200',
    BUSY:      'bg-rose-500    ring-rose-200',
    LUNCH:     'bg-amber-400   ring-amber-200',
    AWAY:      'bg-slate-400   ring-slate-200',
  }[(u.presence ?? 'AWAY') as string] ?? 'bg-slate-400 ring-slate-200';

  return (
    <div className="relative flex-shrink-0">
      <div className={`flex ${dim} items-center justify-center rounded-full bg-gradient-to-br from-slate-600 to-slate-800 font-bold text-white`}>
        {initials}
      </div>
      <span className={`absolute ${dot} rounded-full ring-2 ring-white ${presenceColor}`} />
    </div>
  );
}

function PresenceLabel({ presence }: { presence?: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    AVAILABLE: { label: 'Available',    cls: 'text-emerald-600' },
    BUSY:      { label: 'Busy',         cls: 'text-rose-600' },
    LUNCH:     { label: 'Away / Lunch', cls: 'text-amber-600' },
    AWAY:      { label: 'Offline',      cls: 'text-slate-400' },
  };
  const info = map[presence ?? 'AWAY'] ?? map.AWAY;
  return <div className={`mt-0.5 text-[11px] font-medium ${info.cls}`}>● {info.label}</div>;
}

// =========================================================================
// Calls list / new / detail  (unchanged behaviour, lightly restyled)
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
        <Link to="/portal/calls/new" className="rounded-md bg-amber-500 px-3 py-1.5 text-xs font-semibold text-white hover:bg-amber-400">
          <Plus size={12} className="mr-1 inline" />Log a Call
        </Link>
      } />
      <div className="flex gap-1 rounded-lg bg-slate-200/50 p-1 text-xs">
        {(['open','in_progress','closed','all'] as const).map(s => (
          <button key={s} onClick={() => setStatus(s)}
            className={`flex-1 rounded-md px-3 py-1.5 ${status===s ? 'bg-white shadow-sm font-semibold text-slate-900' : 'text-slate-500'}`}>
            {s.replace('_',' ').replace(/\b\w/g, c => c.toUpperCase())}
          </button>
        ))}
      </div>
      <div className="space-y-2">
        {q.isLoading ? <SkeletonList count={3}/> :
          q.data?.length ? q.data.map((t: any) => <CallCard key={t.id} t={t}/>) :
          <EmptyMessage emoji="📭" title="No calls in this view." hint={status === 'closed' ? "Resolved calls will appear here once IT marks them closed." : "Looking quiet. Enjoy it."}/>}
      </div>
    </div>
  );
}

function CallNew() {
  const me = useMe();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [storeId, setStoreId]       = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [description, setDescription] = useState('');
  const [search, setSearch]         = useState('');

  const issues = useQuery<IssueType[]>({
    queryKey: ['portal','issue-types'],
    queryFn: () => api.get('/portal/issue-types').then(r => r.data),
    staleTime: 10 * 60_000,
  });

  // Auto-pick the only store the user has
  if (me.data && me.data.stores?.length === 1 && !storeId) setStoreId(me.data.stores[0].id);

  const selected = issues.data?.find(i => i.id === categoryId) ?? null;

  // We remember the LAST template we auto-inserted so we can tell whether the
  // user has typed into the box or not. If they haven't (description still
  // matches the last inserted template), we silently swap the template when
  // they pick a different issue. If they have typed, we ask before clobbering.
  const [lastTemplate, setLastTemplate] = useState<string>('');

  function pickIssue(i: IssueType) {
    setCategoryId(i.id);
    const nextTpl = i.issueTemplate ?? '';
    const pristine = description === '' || description === lastTemplate;
    if (pristine) {
      setDescription(nextTpl);
      setLastTemplate(nextTpl);
      return;
    }
    // User has typed - don't throw their work away without asking.
    if (window.confirm('Replace your notes with the template for this issue?\n\n(Cancel to keep what you typed.)')) {
      setDescription(nextTpl);
      setLastTemplate(nextTpl);
    }
  }

  const create = useMutation({
    mutationFn: () => api.post('/portal/tickets', {
      storeId, categoryId, description,
    }).then(r => r.data),
    onSuccess: (t) => { qc.invalidateQueries({ queryKey: ['portal'] }); navigate(`/portal/calls/${t.id}`); },
    onError: (e: any) => alert(e?.response?.data?.message ?? 'Failed to log call'),
  });

  // Group the issue catalog by code prefix (POS-, PR-, NET- etc.) for the
  // picker so the store user scans a small group rather than one long list.
  const grouped = groupIssues(issues.data ?? [], search);

  return (
    <div className="space-y-3">
      <PortalBreadcrumb back="/portal/calls" title="Log a Call" />
      <form className="space-y-4" onSubmit={e => { e.preventDefault(); if (!categoryId) { alert('Pick an issue first'); return; } create.mutate(); }}>
        {me.data && me.data.stores.length > 1 && (
          <div className="rounded-xl bg-white p-4 shadow-sm">
            <Field label="Which store?">
              <select className="input w-full" value={storeId} onChange={e => setStoreId(e.target.value)} required>
                <option value="">Select…</option>
                {me.data.stores.map((s: any) => <option key={s.id} value={s.id}>{s.code} - {s.name}</option>)}
              </select>
            </Field>
          </div>
        )}

        {/* ---- 1. Pick an issue ---- */}
        <div className="rounded-xl bg-white p-4 shadow-sm">
          <h3 className="text-sm font-semibold text-slate-900">1. What's the issue?</h3>
          <p className="mt-0.5 text-xs text-slate-400">Pick the one that fits best - it decides who gets this call and how urgent we treat it.</p>

          <input className="input mt-3 w-full" placeholder="Search issues…" value={search} onChange={e => setSearch(e.target.value)} />

          <div className="mt-3 space-y-4">
            {issues.isLoading && <SkeletonList count={3}/>}
            {!issues.isLoading && !grouped.length && (
              <EmptyMessage
                emoji="🔎"
                title={`No issues match "${search}"`}
                hint="Try different wording, or pick 'Other' if nothing fits."
              />
            )}
            {grouped.map(([group, items]) => {
              const meta = Object.values(GROUP_META).find(m => m.label === group) ?? GROUP_META.OTHER;
              return (
                <div key={group}>
                  <div className="mb-1.5 flex items-center gap-1.5">
                    <IconBadge icon={meta.icon} tone={meta.tone} size="sm" />
                    <span className="text-[11px] font-semibold uppercase tracking-wider text-slate-600 dark:text-slate-300">{group}</span>
                  </div>
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {items.map(i => {
                      const m = metaFor(i.code);
                      const active = categoryId === i.id;
                      return (
                        <button key={i.id} type="button" onClick={() => pickIssue(i)}
                          className={`group flex items-start gap-2.5 rounded-xl border p-3 text-left transition
                            ${active
                              ? 'border-brand-400 bg-brand-50 shadow-md ring-2 ring-brand-200 dark:border-brand-500 dark:bg-brand-950/40 dark:ring-brand-700'
                              : 'border-slate-200 bg-white hover:-translate-y-0.5 hover:border-slate-300 hover:shadow dark:border-slate-800 dark:bg-slate-900 dark:hover:border-slate-700'}`}
                        >
                          <IconBadge icon={m.icon} tone={m.tone} size="md" />
                          <div className="min-w-0 flex-1">
                            <div className="flex items-start justify-between gap-2">
                              <div className="text-xs font-semibold text-slate-900 dark:text-white">{i.name}</div>
                              <PriorityPill priority={i.defaultPriority}/>
                            </div>
                            {i.description && <div className="mt-0.5 line-clamp-2 text-[11px] text-slate-500 dark:text-slate-400">{i.description}</div>}
                          </div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* ---- 2. Details ---- */}
        {selected && (
          <div className="rounded-xl bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-slate-900">2. Fill in the details</h3>
              <span className={`rounded px-2 py-0.5 text-[10px] font-bold uppercase ${priorityPillColor(selected.defaultPriority)}`}>
                Priority: {priorityLabel(selected.defaultPriority)} (auto-set)
              </span>
            </div>
            <p className="mt-0.5 text-xs text-slate-400">
              Answer every line below - the more detail, the faster the tech can fix it.
            </p>
            <textarea className="input mt-3 w-full font-mono text-[12px]" rows={9}
              value={description} onChange={e => setDescription(e.target.value)}
              placeholder={selected.issueTemplate ?? 'Describe the issue in detail…'} />
          </div>
        )}

        <div className="flex justify-end gap-2">
          <Link to="/portal/calls" className="btn-ghost">Cancel</Link>
          <button type="submit" className="btn-primary" disabled={create.isPending || !categoryId}>
            {create.isPending ? 'Logging…' : 'Log Call'}
          </button>
        </div>
      </form>
    </div>
  );
}

// Group issues by code prefix (POS-, PR-, NET-, etc.) into friendly headings.
type IssueType = {
  id: string; code: string; name: string; description: string | null;
  defaultPriority: string; issueTemplate: string | null; sortOrder: number;
};
const GROUP_META: Record<string, { label: string; icon: JSX.Element; tone: 'sky'|'amber'|'emerald'|'rose'|'violet'|'cyan'|'pink'|'orange'|'slate' }> = {
  POS:     { label: 'Point of Sale',     icon: <BadgeDollarSign size={14}/>, tone: 'amber' },
  DOLFIN:  { label: 'Dolfin',            icon: <FileText size={14}/>,        tone: 'orange' },
  PR:      { label: 'Printers',          icon: <Printer size={14}/>,         tone: 'sky' },
  PIN:     { label: 'PIN Pad / Nedbank', icon: <CreditCard size={14}/>,      tone: 'violet' },
  NET:     { label: 'Network / Internet', icon: <Wifi size={14}/>,           tone: 'cyan' },
  EOD:     { label: 'End of Day',        icon: <BadgeDollarSign size={14}/>, tone: 'emerald' },
  SIG:     { label: 'Signage / TVs',     icon: <Monitor size={14}/>,         tone: 'pink' },
  CCTV:    { label: 'CCTV',              icon: <Camera size={14}/>,          tone: 'rose' },
  EMAIL:   { label: 'Email / Outlook',   icon: <MailIcon size={14}/>,        tone: 'sky' },
  HW:      { label: 'Hardware',          icon: <HardDrive size={14}/>,       tone: 'slate' },
  BARCODE: { label: 'Scanners',          icon: <ScanBarcode size={14}/>,     tone: 'violet' },
  OTHER:   { label: 'Other',             icon: <HelpCircle size={14}/>,      tone: 'slate' },
};
function metaFor(code: string) {
  const prefix = code.split('-')[0];
  return GROUP_META[prefix] ?? GROUP_META['OTHER'];
}
const PREFIX_LABEL: Record<string, string> = Object.fromEntries(
  Object.entries(GROUP_META).map(([k, v]) => [k, v.label]),
);
function groupIssues(all: IssueType[], search: string): [string, IssueType[]][] {
  const q = search.trim().toLowerCase();
  const filtered = q
    ? all.filter(i => (i.name + ' ' + (i.description ?? '') + ' ' + i.code).toLowerCase().includes(q))
    : all;
  const bins: Record<string, IssueType[]> = {};
  for (const i of filtered) {
    const prefix = i.code.split('-')[0];
    const label = PREFIX_LABEL[prefix] ?? 'Other';
    (bins[label] ??= []).push(i);
  }
  return Object.entries(bins).sort(([a],[b]) => a.localeCompare(b));
}
function priorityLabel(p: string) {
  return ({ P1: 'Critical', P2: 'High', P3: 'Medium', P4: 'Low' } as Record<string, string>)[p] ?? p;
}
function priorityPillColor(p: string) {
  return ({
    P1: 'bg-rose-500   text-white',
    P2: 'bg-amber-500  text-white',
    P3: 'bg-sky-500    text-white',
    P4: 'bg-slate-400  text-white',
  } as Record<string, string>)[p] ?? 'bg-slate-500 text-white';
}

function CallDetail() {
  const { id } = useParams();
  const q = useQuery({
    queryKey: ['portal','ticket',id],
    queryFn: () => api.get(`/portal/tickets/${id}`).then(r => r.data),
  });

  if (q.isLoading) return <SkeletonCard lines={4}/>;
  if (!q.data)    return <EmptyMessage emoji="🫥" title="Not found." hint="This call may have been closed or belongs to a different store."/>;
  const t = q.data;

  return (
    <div className="space-y-3">
      <PortalBreadcrumb back="/portal/calls" title={`${t.code} - ${t.subject}`} />
      <div className="grid gap-3 lg:grid-cols-3">
        <div className="lg:col-span-2 space-y-3">
          <div className="rounded-xl bg-white p-5 shadow-sm">
            <div className="flex items-center gap-2">
              <StatusPill status={t.status}/>
              <span className="text-xs text-slate-400">Logged {new Date(t.createdAt).toLocaleString()}</span>
            </div>
            <p className="mt-3 whitespace-pre-wrap text-sm text-slate-700">
              {t.description || <em className="text-slate-400">No description</em>}
            </p>
          </div>
          {t.comments?.length > 0 && (
            <div className="rounded-xl bg-white p-5 shadow-sm">
              <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-slate-500">Updates from IT</h3>
              <div className="space-y-2">
                {t.comments.map((c: any) => (
                  <div key={c.id} className="rounded-lg bg-slate-50 p-3 text-xs">
                    <div className="mb-1 flex justify-between text-slate-400">
                      <span className="font-semibold text-slate-700">{c.author?.fullName ?? 'IT'}</span>
                      <span>{new Date(c.createdAt).toLocaleString()}</span>
                    </div>
                    <p className="whitespace-pre-wrap text-slate-700">{c.body}</p>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>
        <aside>
          <WidgetHeader title="Assigned Technician"/>
          {t.assignedTo ? (
            <div className="mt-2 rounded-xl bg-white p-4 shadow-sm">
              <div className="flex items-center gap-3">
                <PresenceAvatar u={{ fullName: t.assignedTo.fullName }} size="lg"/>
                <div>
                  <div className="font-semibold text-slate-900">{t.assignedTo.fullName}</div>
                  <div className="text-xs text-slate-400">IT</div>
                </div>
              </div>
            </div>
          ) : (
            <EmptyCard>Not yet assigned.</EmptyCard>
          )}
        </aside>
      </div>
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
      <PortalBreadcrumb back="/portal" title="Repairs in Progress" />
      <div className="rounded-xl bg-amber-50 border border-amber-200 p-3 text-xs text-amber-800">
        <b>Note:</b> you no longer log repairs here. Log a <Link to="/portal/calls/new" className="underline font-semibold">call</Link> instead
        - if the item needs to be sent for repair, your technician will arrange it and you'll see progress on this page.
      </div>
      <div className="flex gap-1 rounded-lg bg-slate-200/50 p-1 text-xs">
        {(['open','closed','all'] as const).map(s => (
          <button key={s} onClick={() => setStatus(s)}
            className={`flex-1 rounded-md px-3 py-1.5 ${status===s ? 'bg-white shadow-sm font-semibold text-slate-900' : 'text-slate-500'}`}>
            {s === 'open' ? 'In Progress' : s[0].toUpperCase()+s.slice(1)}
          </button>
        ))}
      </div>
      <div className="space-y-2">
        {q.data?.length ? q.data.map((r: any) => (
          <Link key={r.id} to={`/portal/repairs/${r.id}`} className="block rounded-xl bg-white p-4 shadow-sm hover:shadow-md">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-2">
                  <span className="rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px] text-slate-500">{r.code}</span>
                  <StatusPill status={r.status}/>
                </div>
                <div className="mt-1 truncate text-sm font-semibold text-slate-900">
                  {r.itemDescription || (r.asset?.assetTag ? `Asset ${r.asset.assetTag}` : 'Item')}
                </div>
                <div className="mt-0.5 line-clamp-1 text-[11px] text-slate-500">{r.faultDesc}</div>
                <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[11px] text-slate-400">
                  <span>{r.store?.code}</span>
                  {r.technicianName && <span>Tech: <b className="text-slate-600">{r.technicianName}</b></span>}
                  {r.waybillNumber && <span>WB: <b className="text-slate-600">{r.waybillNumber}</b></span>}
                  {r.dispatchedDate && <span>Dispatched {new Date(r.dispatchedDate).toLocaleDateString()}</span>}
                </div>
              </div>
            </div>
          </Link>
        )) : (q.isLoading ? <SkeletonList count={3}/> : <EmptyMessage emoji="🔧" title="Nothing in for repair." hint="If anything needs sending away, IT will set it up from a call."/>)}
      </div>
    </div>
  );
}

// RepairNew removed - stores no longer log repairs. Technicians convert
// tickets to repairs from the Helpdesk ticket detail (POST /repairs/from-ticket/:id).

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

  if (q.isLoading) return <SkeletonCard lines={5}/>;
  if (!q.data)    return <EmptyMessage emoji="🫥" title="Not found."/>;
  const r = q.data;

  return (
    <div className="space-y-3">
      <PortalBreadcrumb back="/portal/repairs" title={`${r.code} - ${r.itemDescription ?? 'Repair'}`} />
      <div className="rounded-xl bg-white p-5 shadow-sm">
        <div className="flex items-center gap-2 text-xs">
          <StatusPill status={r.status}/>
          <span className="text-slate-400">Logged {new Date(r.createdAt).toLocaleString()}</span>
        </div>
        <dl className="mt-4 grid grid-cols-1 gap-x-6 gap-y-2 text-sm sm:grid-cols-2">
          <Row label="Store"       v={r.store?.code ?? '-'}/>
          <Row label="Status"      v={prettyStatus(r.status)}/>
          <Row label="Item"        v={r.itemDescription ?? (r.asset?.assetTag ?? '-')}/>
          <Row label="Fault"       v={r.faultDesc}/>
          <Row label="Technician"  v={r.technicianName ?? '-'}/>
          <Row label="Waybill"     v={r.waybillNumber ?? '-'}/>
          <Row label="Dispatched"  v={r.dispatchedDate ? new Date(r.dispatchedDate).toLocaleDateString() : '-'}/>
          <Row label="Returned"    v={r.returnedDate ? new Date(r.returnedDate).toLocaleDateString() : '-'}/>
        </dl>
        <div className="mt-4 flex gap-2">
          {!r.returnedDate && r.status !== 'RETURNED' && (
            <button className="btn-primary" onClick={() => upd.mutate({ returnedDate: new Date().toISOString(), status: 'RETURNED' })}>
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

  const grouped: Record<string, any[]> = {};
  for (const a of q.data ?? []) {
    const k = a.category?.name ?? 'Other';
    (grouped[k] ??= []).push(a);
  }

  return (
    <div className="space-y-3">
      <PortalBreadcrumb back="/portal" title="My Asset Register" />
      <input className="input w-full" placeholder="Search by asset number, serial, model…"
        value={search} onChange={e => setSearch(e.target.value)}/>
      {q.isLoading && <SkeletonList count={4}/>}
      {!q.isLoading && !q.data?.length && <EmptyMessage emoji="📦" title="No equipment on file." hint="If you think there should be, ask IT to double-check your asset register."/>}
      {Object.entries(grouped).map(([cat, items]) => (
        <div key={cat} className="overflow-hidden rounded-xl bg-white shadow-sm">
          <div className="border-b border-slate-100 bg-slate-50 px-3 py-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
            {cat} <span className="font-normal text-slate-400">({items.length})</span>
          </div>
          <div className="divide-y divide-slate-100">
            {items.map(a => (
              <div key={a.id} className="grid grid-cols-1 gap-1 px-3 py-2 text-xs sm:grid-cols-5 sm:items-center">
                <div className="font-mono text-[11px] text-slate-500">{a.assetNumber}</div>
                <div className="font-semibold text-slate-900">{a.manufacturer} {a.model}</div>
                <div className="text-slate-400">SN: {a.serialNumber ?? '-'}</div>
                <div className="text-slate-400">{a.store?.code}</div>
                <div><StatusPill status={a.status}/></div>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

// =========================================================================
// Shared primitives
// =========================================================================

function useMe() {
  type Contact = { id: string; fullName: string; phone: string | null; email: string; presence: string; roleName?: string };
  return useQuery<{
    userId: string; fullName: string; email: string;
    role: string; roleName: string; stores: any[]; isMultiStore: boolean;
    onCall:         null | (Contact & { until: string; notes: string | null });
    defaultContact: null | Contact;
  }>({
    queryKey: ['portal','me'],
    queryFn: () => api.get('/portal/me').then(r => r.data),
    staleTime: 60_000,
    refetchInterval: 60_000,   // keep on-call + stores fresh
  });
}

function PortalBreadcrumb({ back, title, action }: { back: string; title: string; action?: JSX.Element }) {
  return (
    <div className="flex items-center justify-between">
      <Link to={back} className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-900">
        <ArrowLeft size={12}/>Back
      </Link>
      <h1 className="truncate text-sm font-semibold text-slate-900">{title}</h1>
      <div>{action}</div>
    </div>
  );
}

function Field({ label, hint, children }: { label: string; hint?: string; children: JSX.Element }) {
  return (
    <label className="block space-y-1">
      <span className="text-xs font-semibold text-slate-700">{label}</span>
      {hint && <span className="block text-[11px] text-slate-400">{hint}</span>}
      {children}
    </label>
  );
}

function Row({ label, v }: { label: string; v: string }) {
  return (
    <div className="flex gap-2">
      <dt className="w-24 shrink-0 text-slate-400">{label}:</dt>
      <dd className="min-w-0 flex-1 break-words text-slate-800">{v}</dd>
    </div>
  );
}

// Store-friendly labels + colour map. We use leading dots and gradients so
// the pills register even in a glance from across the back office.
function StatusPill({ status }: { status: string }) {
  const info = STATUS_INFO[status] ?? { label: prettyStatus(status), tone: 'slate', dot: '•' };
  const cls = {
    sky:     'bg-gradient-to-r from-sky-50 to-sky-100     text-sky-700   ring-sky-200    dark:from-sky-950 dark:to-sky-900 dark:text-sky-300 dark:ring-sky-800',
    amber:   'bg-gradient-to-r from-amber-50 to-amber-100 text-amber-700 ring-amber-200  dark:from-amber-950 dark:to-amber-900 dark:text-amber-300 dark:ring-amber-800',
    emerald: 'bg-gradient-to-r from-emerald-50 to-emerald-100 text-emerald-700 ring-emerald-200 dark:from-emerald-950 dark:to-emerald-900 dark:text-emerald-300 dark:ring-emerald-800',
    rose:    'bg-gradient-to-r from-rose-50 to-rose-100   text-rose-700  ring-rose-200   dark:from-rose-950 dark:to-rose-900 dark:text-rose-300 dark:ring-rose-800',
    slate:   'bg-gradient-to-r from-slate-50 to-slate-100 text-slate-600 ring-slate-200  dark:from-slate-800 dark:to-slate-700 dark:text-slate-300 dark:ring-slate-600',
  }[info.tone];
  const dotCls = {
    sky:     'bg-sky-500',
    amber:   'bg-amber-500',
    emerald: 'bg-emerald-500',
    rose:    'bg-rose-500',
    slate:   'bg-slate-400',
  }[info.tone];
  return (
    <span className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-semibold ring-1 ring-inset ${cls}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${dotCls}`} />
      {info.label}
    </span>
  );
}
const STATUS_INFO: Record<string, { label: string; tone: 'sky'|'amber'|'emerald'|'rose'|'slate'; dot?: string }> = {
  OPEN:            { label: 'Open',               tone: 'sky' },
  NEW:             { label: 'Logged',             tone: 'sky' },
  ASSIGNED:        { label: 'Assigned',           tone: 'sky' },
  REOPENED:        { label: 'Reopened',           tone: 'amber' },
  IN_PROGRESS:     { label: "We're on it",        tone: 'amber' },
  WAITING_ON_USER: { label: 'Waiting on you',     tone: 'amber' },
  RESOLVED:        { label: 'Resolved',           tone: 'emerald' },
  CLOSED:          { label: 'Closed',             tone: 'slate' },
  LOGGED:          { label: 'Logged',             tone: 'sky' },
  COLLECTED:       { label: 'Collected',          tone: 'amber' },
  AT_SUPPLIER:     { label: 'At supplier',        tone: 'amber' },
  REPAIRED:        { label: 'Repaired',           tone: 'emerald' },
  RETURNED:        { label: 'Returned',           tone: 'emerald' },
  REPLACED:        { label: 'Replaced',           tone: 'emerald' },
  WRITTEN_OFF:     { label: 'Written off',        tone: 'rose' },
  CANCELLED:       { label: 'Cancelled',          tone: 'slate' },
};

function PriorityPill({ priority }: { priority: string }) {
  const info = {
    P1: { label: 'Critical', cls: 'bg-gradient-to-r from-rose-500 to-rose-600 text-white' },
    P2: { label: 'High',     cls: 'bg-gradient-to-r from-amber-400 to-amber-500 text-white' },
    P3: { label: 'Medium',   cls: 'bg-gradient-to-r from-sky-400 to-sky-500 text-white' },
    P4: { label: 'Low',      cls: 'bg-slate-200 text-slate-700 dark:bg-slate-700 dark:text-slate-300' },
  }[priority as string];
  if (!info) return <span>{priority}</span>;
  return <span className={`inline-flex items-center rounded-md px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide shadow-sm ${info.cls}`}>{info.label}</span>;
}

function prettyStatus(s: string) {
  return s.replace(/_/g, ' ').toLowerCase().replace(/\b\w/g, c => c.toUpperCase());
}
