import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { PageHeader } from '@/components/PageHeader';
import { useAuth } from '@/store/auth';
import {
  Activity, Cpu, HardDrive, Monitor, Power, Terminal, Zap, Search, Plus, Trash2, Edit3,
  CheckSquare, Square, FileCode2, Play, X, Camera, Upload, Download, MousePointerClick,
  ChevronRight, ChevronDown, LayoutGrid, Users, Server, Building2, Store as StoreIcon,
  CircleDot, Filter, RefreshCcw, Keyboard, Settings2,
} from 'lucide-react';
import clsx from 'clsx';

// -------------------------------------------------------------------------
// VSA-style RMM module
//
// Three-pane layout:
//   ├─ Left nav rail (groups + filters, tree-expandable)
//   ├─ Middle: dense agent grid with status LEDs, multiselect, right-click
//   └─ Right: contextual action pane (PC detail, bulk toolbox, scripts library)
//
// Visual language borrows from Kaseya VSA: slate chrome, LED-style status
// dots, tight row height, monospace machine identifiers, hover-only
// quick-actions, bottom status bar with fleet totals.
// -------------------------------------------------------------------------

type Conn = {
  id: string;
  agentPcId: string;
  isOnline: boolean;
  live?: boolean;
  lastSeenAt?: string;
  osName?: string;
  osVersion?: string;
  agentVersion?: string;
  publicIp?: string;
  localIp?: string;
  pcName?: string;
  scope?: 'STORE' | 'HQ';
  storeCode?: string;
  storeName?: string;
  departmentName?: string;
};

type NavKey = { group: 'ALL' | 'ONLINE' | 'OFFLINE' | 'STORE' | 'HQ' | 'SCOPE'; value?: string };

export function Rmm() {
  const conns = useQuery({
    queryKey: ['rmm-connections'],
    queryFn: () => api.get<Conn[]>('/rmm/connections').then((r) => r.data),
    refetchInterval: 5_000,
  });

  const [selected, setSelected] = useState<string | null>(null);
  const [picked, setPicked]     = useState<Set<string>>(new Set());
  const [search, setSearch]     = useState('');
  const [nav, setNav]           = useState<NavKey>({ group: 'ALL' });
  const [showScripts, setShowScripts] = useState(false);
  const [showContextMenu, setShowContextMenu] = useState<{ x: number; y: number; pcId: string } | null>(null);
  const [showRemoteFor, setShowRemoteFor] = useState<string | null>(null);

  // Close context menu on outside click.
  useEffect(() => {
    if (!showContextMenu) return;
    const onDoc = () => setShowContextMenu(null);
    window.addEventListener('mousedown', onDoc);
    return () => window.removeEventListener('mousedown', onDoc);
  }, [showContextMenu]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (conns.data ?? [])
      .filter((c) => {
        switch (nav.group) {
          case 'ONLINE':  return c.isOnline;
          case 'OFFLINE': return !c.isOnline;
          case 'STORE':   return c.scope === 'STORE' && (!nav.value || c.storeCode === nav.value);
          case 'HQ':      return c.scope === 'HQ' && (!nav.value || c.departmentName === nav.value);
          case 'SCOPE':   return !nav.value || c.scope === nav.value;
          case 'ALL':
          default:        return true;
        }
      })
      .filter((c) => {
        if (!q) return true;
        return [c.pcName, c.osName, c.storeCode, c.storeName, c.departmentName, c.agentPcId, c.localIp, c.publicIp]
          .some((s) => (s ?? '').toLowerCase().includes(q));
      });
  }, [conns.data, nav, search]);

  const online  = conns.data?.filter((c) => c.isOnline).length ?? 0;
  const offline = (conns.data?.length ?? 0) - online;

  function togglePick(pcId: string) {
    const next = new Set(picked);
    if (next.has(pcId)) next.delete(pcId); else next.add(pcId);
    setPicked(next);
  }

  return (
    <>
      <PageHeader
        title="RMM — Agents"
        subtitle={`${online} online · ${offline} offline`}
        actions={
          <>
            <button className="btn-ghost" onClick={() => conns.refetch()}>
              <RefreshCcw size={13}/>Refresh
            </button>
            <button className="btn-ghost" onClick={() => setShowScripts(true)}>
              <FileCode2 size={13}/>Agent procedures
            </button>
          </>
        }
      />

      {/* 3-pane shell */}
      <div className="grid grid-cols-1 gap-3 lg:grid-cols-[220px_1fr_360px]">
        {/* ============== Left nav rail ============== */}
        <NavRail connections={conns.data ?? []} value={nav} onChange={setNav}/>

        {/* ============== Middle: agent grid ============== */}
        <section className="card p-0 overflow-hidden">
          {/* Toolbar */}
          <div className="flex flex-wrap items-center gap-2 border-b border-ink-500/10 bg-slate-50 p-2">
            <div className="relative flex-1 min-w-[180px]">
              <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-300"/>
              <input className="field pl-7 text-xs !py-1" placeholder="Search machine / IP / store / OS…"
                value={search} onChange={(e) => setSearch(e.target.value)}/>
            </div>
            <div className="text-[11px] text-ink-300">
              {picked.size > 0 ? `${picked.size} selected` : `${filtered.length} machines`}
            </div>
            {picked.size > 0 && (
              <>
                <button className="btn-ghost text-xs !py-1" onClick={() => setShowScripts(true)}>
                  <Play size={11}/>Run procedure
                </button>
                <button className="btn-ghost text-xs !py-1" onClick={() => setPicked(new Set())}>
                  Clear
                </button>
              </>
            )}
          </div>

          {/* Grid */}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[920px] text-xs">
              <thead className="sticky top-0 bg-slate-100 text-ink-200">
                <tr>
                  <th className="w-8 px-2 py-1.5 text-left">
                    <input type="checkbox"
                      checked={filtered.length > 0 && filtered.every((c) => picked.has(c.agentPcId))}
                      onChange={(e) => {
                        const next = new Set(picked);
                        if (e.target.checked) filtered.forEach((c) => next.add(c.agentPcId));
                        else filtered.forEach((c) => next.delete(c.agentPcId));
                        setPicked(next);
                      }}/>
                  </th>
                  <th className="w-10 px-2 py-1.5 text-left">St</th>
                  <th className="px-2 py-1.5 text-left">Machine ID</th>
                  <th className="px-2 py-1.5 text-left">Group</th>
                  <th className="px-2 py-1.5 text-left">OS</th>
                  <th className="px-2 py-1.5 text-left">IP</th>
                  <th className="px-2 py-1.5 text-left">Agent</th>
                  <th className="px-2 py-1.5 text-right">Last check-in</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((c) => {
                  const isSel = selected === c.agentPcId;
                  const checked = picked.has(c.agentPcId);
                  return (
                    <tr key={c.id}
                      className={clsx(
                        'cursor-default border-b border-ink-500/5 font-mono hover:bg-sky-50',
                        isSel && 'bg-sky-100 font-semibold',
                      )}
                      onClick={() => setSelected(c.agentPcId)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        setSelected(c.agentPcId);
                        setShowContextMenu({ x: e.clientX, y: e.clientY, pcId: c.agentPcId });
                      }}>
                      <td className="px-2 py-1" onClick={(e) => e.stopPropagation()}>
                        <input type="checkbox" checked={checked} onChange={() => togglePick(c.agentPcId)}/>
                      </td>
                      <td className="px-2 py-1">
                        <StatusLed online={c.isOnline} lastSeen={c.lastSeenAt}/>
                      </td>
                      <td className="px-2 py-1 text-ink-50">
                        {c.pcName ?? c.osName ?? c.agentPcId.slice(0, 10)}
                      </td>
                      <td className="px-2 py-1 text-ink-200">
                        {c.scope === 'HQ'
                          ? `HQ · ${c.departmentName ?? '—'}`
                          : c.storeCode ? `${c.storeCode} — ${c.storeName ?? ''}` : '—'}
                      </td>
                      <td className="px-2 py-1 text-ink-200">{c.osName ?? '—'}</td>
                      <td className="px-2 py-1 text-ink-200">{c.localIp ?? '—'}</td>
                      <td className="px-2 py-1 text-ink-300">{c.agentVersion ?? '—'}</td>
                      <td className="px-2 py-1 text-right text-ink-300">
                        {c.isOnline ? 'now' : c.lastSeenAt ? timeAgo(c.lastSeenAt) : 'never'}
                      </td>
                    </tr>
                  );
                })}
                {filtered.length === 0 && (
                  <tr><td colSpan={8} className="py-10 text-center text-ink-300">
                    {conns.data?.length === 0
                      ? 'No agents have connected yet.'
                      : 'No machines match the current filter.'}
                  </td></tr>
                )}
              </tbody>
            </table>
          </div>

          {/* Status bar */}
          <div className="border-t border-ink-500/10 bg-slate-50 px-3 py-1 text-[10px] text-ink-300">
            Total {conns.data?.length ?? 0} · Online {online} · Offline {offline}
            {picked.size > 0 && ` · ${picked.size} selected`}
          </div>
        </section>

        {/* ============== Right rail: PC detail / bulk ============== */}
        <aside className="min-h-[400px]">
          {picked.size > 0 ? (
            <BulkPanel picked={[...picked]} onClear={() => setPicked(new Set())}
              onOpenScripts={() => setShowScripts(true)}/>
          ) : selected ? (
            <PcDetail agentPcId={selected}
              onOpenScripts={() => setShowScripts(true)}
              onRemote={() => setShowRemoteFor(selected)}/>
          ) : (
            <div className="card p-6 text-center text-xs text-ink-300">
              Pick a machine on the left — or tick some to run a procedure across many.
            </div>
          )}
        </aside>
      </div>

      {showScripts && (
        <ScriptLibrary
          onClose={() => setShowScripts(false)}
          runTargets={picked.size > 0 ? [...picked] : (selected ? [selected] : [])}
        />
      )}

      {showContextMenu && (
        <ContextMenu pos={showContextMenu}
          onClose={() => setShowContextMenu(null)}
          onRemote={() => { setShowRemoteFor(showContextMenu.pcId); setShowContextMenu(null); }}
          onScripts={() => { setSelected(showContextMenu.pcId); setShowScripts(true); setShowContextMenu(null); }}/>
      )}

      {showRemoteFor && (
        <RemoteDesktop agentPcId={showRemoteFor} onClose={() => setShowRemoteFor(null)}/>
      )}
    </>
  );
}

// =========================================================================
//  Left nav rail — tree with groups + filters
// =========================================================================
function NavRail({ connections, value, onChange }: {
  connections: Conn[]; value: NavKey; onChange: (n: NavKey) => void;
}) {
  const [storesOpen, setStoresOpen] = useState(true);
  const [deptsOpen,  setDeptsOpen]  = useState(true);

  const stores = useMemo(() => {
    const m = new Map<string, { code: string; name: string; total: number; online: number }>();
    connections.forEach((c) => {
      if (c.scope !== 'STORE' || !c.storeCode) return;
      const row = m.get(c.storeCode) ?? { code: c.storeCode, name: c.storeName ?? '', total: 0, online: 0 };
      row.total++; if (c.isOnline) row.online++;
      m.set(c.storeCode, row);
    });
    return [...m.values()].sort((a, b) => a.code.localeCompare(b.code));
  }, [connections]);

  const depts = useMemo(() => {
    const m = new Map<string, { name: string; total: number; online: number }>();
    connections.forEach((c) => {
      if (c.scope !== 'HQ' || !c.departmentName) return;
      const row = m.get(c.departmentName) ?? { name: c.departmentName, total: 0, online: 0 };
      row.total++; if (c.isOnline) row.online++;
      m.set(c.departmentName, row);
    });
    return [...m.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [connections]);

  const NavItem = ({ active, icon, label, count, onClick, depth = 0 }: any) => (
    <button
      onClick={onClick}
      style={{ paddingLeft: 8 + depth * 14 }}
      className={clsx(
        'flex w-full items-center justify-between gap-2 border-l-2 py-1 pr-2 text-left text-xs transition-colors',
        active
          ? 'border-brand-500 bg-brand-50 font-semibold text-brand-700'
          : 'border-transparent text-ink-100 hover:bg-slate-50',
      )}>
      <span className="flex min-w-0 items-center gap-2 truncate">
        {icon}<span className="truncate">{label}</span>
      </span>
      {count !== undefined && (
        <span className="rounded bg-ink-500/10 px-1 py-0.5 text-[9px] font-mono">{count}</span>
      )}
    </button>
  );

  const total   = connections.length;
  const online  = connections.filter((c) => c.isOnline).length;
  const storesTotal = connections.filter((c) => c.scope === 'STORE').length;
  const hqTotal     = connections.filter((c) => c.scope === 'HQ').length;

  const match = (g: NavKey['group'], v?: string) => value.group === g && value.value === v;

  return (
    <aside className="card p-1 text-sm">
      <div className="px-2 py-1 text-[9px] font-semibold uppercase tracking-wider text-ink-300">All machines</div>
      <NavItem active={match('ALL')}     icon={<LayoutGrid size={12}/>} label="All agents"   count={total}  onClick={() => onChange({ group: 'ALL' })}/>
      <NavItem active={match('ONLINE')}  icon={<CircleDot  size={12} className="text-emerald-500"/>} label="Online" count={online} onClick={() => onChange({ group: 'ONLINE' })}/>
      <NavItem active={match('OFFLINE')} icon={<CircleDot  size={12} className="text-slate-400"/>}    label="Offline" count={total - online} onClick={() => onChange({ group: 'OFFLINE' })}/>

      <div className="mt-2 px-2 py-1 text-[9px] font-semibold uppercase tracking-wider text-ink-300">Scope</div>
      <NavItem active={match('SCOPE', 'STORE')} icon={<StoreIcon  size={12}/>} label="Stores" count={storesTotal} onClick={() => onChange({ group: 'SCOPE', value: 'STORE' })}/>
      <NavItem active={match('SCOPE', 'HQ')}    icon={<Building2  size={12}/>} label="HQ"     count={hqTotal}     onClick={() => onChange({ group: 'SCOPE', value: 'HQ' })}/>

      <div className="mt-2 flex items-center justify-between px-2 py-1 text-[9px] font-semibold uppercase tracking-wider text-ink-300">
        <span>Stores</span>
        <button onClick={() => setStoresOpen((v) => !v)} className="text-ink-300 hover:text-ink-50">
          {storesOpen ? <ChevronDown size={10}/> : <ChevronRight size={10}/>}
        </button>
      </div>
      {storesOpen && stores.map((s) => (
        <NavItem key={s.code} depth={1}
          active={match('STORE', s.code)}
          icon={<StatusLed online={s.online > 0} />}
          label={`${s.code} — ${s.name}`}
          count={s.total}
          onClick={() => onChange({ group: 'STORE', value: s.code })}/>
      ))}

      <div className="mt-2 flex items-center justify-between px-2 py-1 text-[9px] font-semibold uppercase tracking-wider text-ink-300">
        <span>HQ departments</span>
        <button onClick={() => setDeptsOpen((v) => !v)} className="text-ink-300 hover:text-ink-50">
          {deptsOpen ? <ChevronDown size={10}/> : <ChevronRight size={10}/>}
        </button>
      </div>
      {deptsOpen && depts.map((d) => (
        <NavItem key={d.name} depth={1}
          active={match('HQ', d.name)}
          icon={<Users size={12}/>}
          label={d.name}
          count={d.total}
          onClick={() => onChange({ group: 'HQ', value: d.name })}/>
      ))}
    </aside>
  );
}

// =========================================================================
//  Status LED — small coloured dot. Green = online, amber = recent, grey = long gone
// =========================================================================
function StatusLed({ online, lastSeen }: { online?: boolean; lastSeen?: string }) {
  const tone = online
    ? 'bg-emerald-500 ring-emerald-200'
    : (lastSeen && Date.now() - new Date(lastSeen).getTime() < 30 * 60_000)
    ? 'bg-amber-400 ring-amber-200'
    : 'bg-slate-400 ring-slate-200';
  return <span className={clsx('inline-block h-2 w-2 shrink-0 rounded-full ring-2', tone)}/>;
}

// =========================================================================
//  Right-click context menu
// =========================================================================
function ContextMenu({ pos, onClose, onRemote, onScripts }: {
  pos: { x: number; y: number }; onClose: () => void; onRemote: () => void; onScripts: () => void;
}) {
  const item = 'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs hover:bg-sky-50';
  return (
    <div className="fixed z-50 min-w-[200px] rounded border border-ink-500/20 bg-white shadow-xl"
      style={{ left: pos.x + 2, top: pos.y + 2 }}
      onClick={(e) => e.stopPropagation()}>
      <button className={item} onClick={onRemote}><MousePointerClick size={12}/>Live Connect (remote control)</button>
      <button className={item} onClick={onScripts}><FileCode2 size={12}/>Run agent procedure</button>
      <button className={item} onClick={onClose}><Camera size={12}/>Screenshot</button>
      <button className={item} onClick={onClose}><Terminal size={12}/>Open command shell</button>
      <div className="my-1 border-t border-ink-500/10"/>
      <button className={item} onClick={onClose}><Power size={12}/>Restart agent</button>
      <button className={item} onClick={onClose}><X size={12}/>Close</button>
    </div>
  );
}

// =========================================================================
//  Bulk panel — shown while multi-select is active
// =========================================================================
function BulkPanel({ picked, onClear, onOpenScripts }: {
  picked: string[]; onClear: () => void; onOpenScripts: () => void;
}) {
  return (
    <section className="card p-4 text-center">
      <h3 className="text-sm font-semibold">{picked.length} machine(s) selected</h3>
      <p className="mt-1 text-[11px] text-ink-300">
        Run a saved procedure across all of them. Each PC executes independently; results collect in its command history.
      </p>
      <div className="mt-3 flex flex-col gap-2">
        <button className="btn-primary" onClick={onOpenScripts}>
          <FileCode2 size={13}/>Run procedure on selected
        </button>
        <button className="btn-ghost" onClick={onClear}>
          <X size={13}/>Clear selection
        </button>
      </div>
    </section>
  );
}

// =========================================================================
//  PC detail — right-pane in VSA style (vertical tabs + info)
// =========================================================================
function PcDetail({ agentPcId, onOpenScripts, onRemote }: {
  agentPcId: string; onOpenScripts: () => void; onRemote: () => void;
}) {
  const qc = useQueryClient();
  const info = useQuery({
    queryKey: ['rmm-pc', agentPcId],
    queryFn: () => api.get(`/rmm/pcs/${agentPcId}`).then((r) => r.data),
    refetchInterval: 5_000,
  });
  const metrics = useQuery({
    queryKey: ['rmm-metrics', agentPcId],
    queryFn: () => api.get(`/rmm/pcs/${agentPcId}/metrics`, { params: { limit: 30 } }).then((r) => r.data),
    refetchInterval: 5_000,
  });
  const history = useQuery({
    queryKey: ['rmm-cmds', agentPcId],
    queryFn: () => api.get(`/rmm/pcs/${agentPcId}/commands`).then((r) => r.data),
    refetchInterval: 3_000,
  });

  const [tab, setTab] = useState<'summary' | 'shell' | 'files' | 'history'>('summary');
  const [script, setScript] = useState('Get-Service | Where-Object Status -eq "Running" | Select Name,DisplayName -First 10');

  const runShell = useMutation({
    mutationFn: () => api.post(`/rmm/pcs/${agentPcId}/shell`, { script, interpreter: 'POWERSHELL' }).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rmm-cmds', agentPcId] }),
  });
  const restart = useMutation({
    mutationFn: () => api.post(`/rmm/pcs/${agentPcId}/restart`, { delaySeconds: 10 }).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rmm-cmds', agentPcId] }),
  });
  const requestSnap = useMutation({
    mutationFn: () => api.post(`/rmm/pcs/${agentPcId}/snapshot`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rmm-cmds', agentPcId] }),
  });
  const latestSnap = useQuery({
    queryKey: ['rmm-snap', agentPcId],
    queryFn: () => api.get(`/agents/pcs/${agentPcId}/screenshot`).then((r) => r.data),
    refetchInterval: 4_000,
  });

  const latest = metrics.data?.[0];
  const bytes = (n: any) => n ? `${(Number(n) / 1024 / 1024 / 1024).toFixed(1)} GB` : '—';

  const live = !!info.data?.live;

  return (
    <div className="card overflow-hidden">
      {/* Header strip — VSA "selected machine" title bar */}
      <div className="border-b border-ink-500/10 bg-slate-50 p-3">
        <div className="flex items-center gap-2">
          <StatusLed online={live} lastSeen={info.data?.lastSeenAt}/>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-bold">{info.data?.osName ?? agentPcId.slice(0, 10)}</div>
            <div className="truncate text-[10px] text-ink-300 font-mono">{agentPcId}</div>
          </div>
        </div>
        <div className="mt-2 grid grid-cols-2 gap-1 text-[10px] text-ink-300">
          <div>OS: <span className="text-ink-100">{info.data?.osVersion ?? '—'}</span></div>
          <div>Agent: <span className="text-ink-100">{info.data?.agentVersion ?? '—'}</span></div>
          <div>Local IP: <span className="text-ink-100 font-mono">{info.data?.localIp ?? '—'}</span></div>
          <div>Public IP: <span className="text-ink-100 font-mono">{info.data?.publicIp ?? '—'}</span></div>
        </div>
      </div>

      {/* Action grid — four tiles like VSA's "Live Connect / Agent Procedures / …" bar */}
      <div className="grid grid-cols-2 gap-1 p-2">
        <ActionTile icon={<MousePointerClick size={14}/>} label="Live Connect" primary disabled={!live} onClick={onRemote}/>
        <ActionTile icon={<FileCode2         size={14}/>} label="Procedures"                 onClick={onOpenScripts}/>
        <ActionTile icon={<Camera            size={14}/>} label="Screenshot"   disabled={!live} onClick={() => requestSnap.mutate()}/>
        <ActionTile icon={<Power             size={14}/>} label="Restart"      disabled={!live} onClick={() => { if (confirm('Restart this PC in 10 seconds?')) restart.mutate(); }}/>
      </div>

      {/* Tabs */}
      <div className="flex border-b border-ink-500/10 text-xs">
        {(['summary', 'shell', 'files', 'history'] as const).map((t) => (
          <button key={t}
            onClick={() => setTab(t)}
            className={clsx(
              'flex-1 py-1.5 font-medium capitalize transition-colors',
              tab === t ? 'border-b-2 border-brand-500 text-brand-700' : 'text-ink-300 hover:text-ink-100',
            )}>{t}</button>
        ))}
      </div>

      <div className="max-h-[600px] overflow-y-auto p-3">
        {tab === 'summary' && (
          <>
            <h4 className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-ink-300">
              <Activity size={10}/>Live metrics
            </h4>
            <div className="grid grid-cols-2 gap-1 text-[11px]">
              <Metric icon={<Cpu       size={11}/>} label="CPU"    value={latest?.cpuPct != null ? `${latest.cpuPct.toFixed(0)}%` : '—'}/>
              <Metric icon={<Monitor   size={11}/>} label="Memory" value={latest?.memUsedBytes ? `${bytes(latest.memUsedBytes)} / ${bytes(latest.memTotalBytes)}` : '—'}/>
              <Metric icon={<HardDrive size={11}/>} label="Disk"   value={latest?.diskUsedBytes ? `${bytes(latest.diskUsedBytes)} / ${bytes(latest.diskTotalBytes)}` : '—'}/>
              <Metric icon={<Users     size={11}/>} label="User"   value={latest?.loggedInUser ?? '—'}/>
            </div>
            <div className="mt-3 h-14">
              <Sparkline values={(metrics.data ?? []).slice().reverse().map((m: any) => m.cpuPct ?? 0)} />
            </div>
            <p className="mt-0.5 text-[10px] text-ink-300">CPU % — last ~5 min</p>

            {latestSnap.data?.url && (
              <div className="mt-4">
                <h4 className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-ink-300">
                  <Camera size={10}/>Last screenshot
                </h4>
                <img src={latestSnap.data.url}
                  className="w-full rounded border border-ink-500/10 object-contain"
                  alt="Last screenshot"/>
                <p className="mt-1 text-[10px] text-ink-300">
                  {new Date(latestSnap.data.takenAt).toLocaleString()}
                </p>
              </div>
            )}
          </>
        )}

        {tab === 'shell' && (
          <>
            <h4 className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-ink-300">
              <Terminal size={10}/>Ad-hoc PowerShell
            </h4>
            <textarea className="field font-mono text-[11px]" rows={6}
              value={script} onChange={(e) => setScript(e.target.value)}/>
            <div className="mt-1 flex items-center justify-between gap-2">
              <span className="text-[10px] text-ink-300">{live ? 'Dispatches immediately.' : 'Queued — runs when the agent reconnects.'}</span>
              <button className="btn-primary text-xs" disabled={!live || runShell.isPending} onClick={() => runShell.mutate()}>
                <Zap size={11}/>{runShell.isPending ? 'Running…' : 'Run'}
              </button>
            </div>
          </>
        )}

        {tab === 'files' && <FileTransferPanel agentPcId={agentPcId} live={live}/>}

        {tab === 'history' && (
          <>
            <h4 className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-ink-300">
              <Keyboard size={10}/>Command history
            </h4>
            <ul className="space-y-1 text-[11px]">
              {(history.data ?? []).length === 0 && <li className="text-ink-300">No commands yet.</li>}
              {history.data?.map((c: any) => (
                <li key={c.id} className="rounded border border-ink-500/10 bg-slate-50/60 p-2">
                  <div className="mb-0.5 flex items-center justify-between">
                    <span className="font-mono text-[9px]">{c.kind} · {c.status}</span>
                    <span className="text-[9px] text-ink-300">
                      {new Date(c.queuedAt).toLocaleTimeString()} · {c.issuedBy?.fullName ?? ''}
                    </span>
                  </div>
                  {(c.kind === 'SHELL' || c.kind === 'SCRIPT') && (
                    <pre className="max-h-16 overflow-auto whitespace-pre-wrap font-mono text-[9px] text-ink-200">
                      {(c.payload as any)?.script?.slice(0, 300) ?? ''}
                    </pre>
                  )}
                  {(c.stdout || c.stderr) && (
                    <pre className="mt-1 max-h-32 overflow-auto whitespace-pre-wrap font-mono text-[9px]">
                      {c.stdout}{c.stderr && <span className="text-rose-500">{'\n' + c.stderr}</span>}
                    </pre>
                  )}
                </li>
              ))}
            </ul>
          </>
        )}
      </div>
    </div>
  );
}

function Metric({ icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="rounded border border-ink-500/10 bg-slate-50/50 p-1.5">
      <div className="flex items-center gap-1 text-[9px] uppercase tracking-wider text-ink-300">{icon}{label}</div>
      <div className="mt-0.5 truncate text-[11px] font-semibold text-ink-100">{value}</div>
    </div>
  );
}

function ActionTile({ icon, label, onClick, primary, disabled }: {
  icon: any; label: string; onClick: () => void; primary?: boolean; disabled?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={clsx(
        'flex items-center gap-2 rounded border p-2 text-left text-xs font-medium transition-colors',
        disabled && 'opacity-40 pointer-events-none',
        primary
          ? 'border-brand-500 bg-brand-500 text-white hover:bg-brand-600'
          : 'border-ink-500/20 bg-white hover:bg-sky-50',
      )}>
      {icon}{label}
    </button>
  );
}

function Sparkline({ values }: { values: number[] }) {
  const max = Math.max(100, ...values);
  const points = values.map((v, i) => `${(i / Math.max(1, values.length - 1)) * 100},${100 - (v / max) * 100}`).join(' ');
  return (
    <svg width="100%" height="100%" viewBox="0 0 100 100" preserveAspectRatio="none">
      <polyline fill="none" stroke="#fe6620" strokeWidth="1.5" points={points} vectorEffect="non-scaling-stroke"/>
    </svg>
  );
}

// =========================================================================
//  Script library modal (unchanged behaviour from before)
// =========================================================================
function ScriptLibrary({ onClose, runTargets }: { onClose: () => void; runTargets: string[] }) {
  const qc = useQueryClient();
  const scripts = useQuery({
    queryKey: ['rmm-scripts'],
    queryFn: () => api.get<any[]>('/rmm/scripts').then((r) => r.data),
  });

  const [editing, setEditing] = useState<any | null>(null);
  const [showNew, setShowNew] = useState(false);

  const runScript = useMutation({
    mutationFn: (scriptId: string) =>
      api.post(`/rmm/scripts/${scriptId}/run`, { agentPcIds: runTargets }).then((r) => r.data),
    onSuccess: (data: any) => {
      const dispatched = (data?.results ?? []).filter((r: any) => r.dispatched).length;
      const queued     = (data?.results ?? []).length - dispatched;
      alert(`Dispatched to ${dispatched} online PC(s). ${queued ? queued + ' queued until agent reconnects.' : ''}`);
      qc.invalidateQueries({ queryKey: ['rmm-cmds'] });
    },
    onError: (e: any) => alert(e?.response?.data?.message ?? 'Run failed'),
  });

  const removeScript = useMutation({
    mutationFn: (id: string) => api.delete(`/rmm/scripts/${id}`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rmm-scripts'] }),
  });

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-3xl rounded-xl bg-white p-5 shadow-2xl"
        onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between">
          <div>
            <h3 className="text-base font-semibold">Agent procedures</h3>
            <p className="text-xs text-ink-300">
              {runTargets.length === 0
                ? 'Browse or manage saved procedures. Pick a machine to enable Run.'
                : `Run against ${runTargets.length} selected machine(s).`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button className="btn-ghost" onClick={() => setShowNew(true)}><Plus size={13}/>New</button>
            <button className="btn-ghost" onClick={onClose}><X size={14}/></button>
          </div>
        </div>

        {(showNew || editing) && (
          <ScriptEditor
            key={editing?.id ?? 'new'}
            initial={editing}
            onCancel={() => { setShowNew(false); setEditing(null); }}
            onSaved={() => {
              setShowNew(false); setEditing(null);
              qc.invalidateQueries({ queryKey: ['rmm-scripts'] });
            }}
          />
        )}

        <ul className="max-h-[50vh] space-y-2 overflow-auto">
          {scripts.data?.length === 0 && (
            <li className="rounded border border-dashed border-ink-500 p-4 text-center text-xs text-ink-300">
              No procedures yet.
            </li>
          )}
          {scripts.data?.map((s) => (
            <li key={s.id} className="rounded border border-ink-500/10 bg-slate-50/50 p-3">
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0 flex-1">
                  <div className="font-semibold">{s.name}</div>
                  <div className="text-[11px] text-ink-300">
                    {s.interpreter} · created by {s.createdBy?.fullName ?? '—'}
                    {s.tags ? ` · ${s.tags}` : ''}
                  </div>
                  {s.description && <div className="mt-1 text-xs text-ink-200">{s.description}</div>}
                </div>
                <div className="flex shrink-0 items-center gap-1">
                  <button className="btn-primary text-xs"
                    disabled={runTargets.length === 0 || runScript.isPending}
                    onClick={() => {
                      if (!confirm(`Run "${s.name}" on ${runTargets.length} machine(s)?`)) return;
                      runScript.mutate(s.id);
                    }}>
                    <Play size={12}/>Run
                  </button>
                  <button className="btn-ghost" onClick={() => setEditing(s)}>
                    <Edit3 size={12}/>
                  </button>
                  <button className="btn-ghost text-rose-600"
                    onClick={() => { if (confirm(`Remove "${s.name}"?`)) removeScript.mutate(s.id); }}>
                    <Trash2 size={12}/>
                  </button>
                </div>
              </div>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}

function ScriptEditor({ initial, onCancel, onSaved }: {
  initial: any | null; onCancel: () => void; onSaved: () => void;
}) {
  const [name, setName]               = useState(initial?.name ?? '');
  const [description, setDescription] = useState(initial?.description ?? '');
  const [interpreter, setInterpreter] = useState(initial?.interpreter ?? 'POWERSHELL');
  const [body, setBody]               = useState(initial?.body ?? '# PowerShell script\n');
  const [tags, setTags]               = useState(initial?.tags ?? '');

  const save = useMutation({
    mutationFn: () => {
      const dto = { name, description, interpreter, body, tags };
      return initial?.id
        ? api.patch(`/rmm/scripts/${initial.id}`, dto).then((r) => r.data)
        : api.post(`/rmm/scripts`, dto).then((r) => r.data);
    },
    onSuccess: () => onSaved(),
    onError: (e: any) => alert(e?.response?.data?.message ?? 'Save failed'),
  });

  return (
    <div className="mb-3 rounded border border-brand-200 bg-brand-50 p-3">
      <div className="mb-2 flex items-center justify-between">
        <h4 className="text-sm font-semibold">
          {initial?.id ? `Edit "${initial.name}"` : 'New agent procedure'}
        </h4>
        <button className="btn-ghost" onClick={onCancel}><X size={13}/></button>
      </div>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div><label className="label">Name</label>
          <input className="field" value={name} onChange={(e) => setName(e.target.value)}/></div>
        <div><label className="label">Interpreter</label>
          <select className="field" value={interpreter} onChange={(e) => setInterpreter(e.target.value)}>
            <option value="POWERSHELL">PowerShell</option>
            <option value="CMD">Windows CMD</option>
            <option value="BASH">Bash</option>
          </select></div>
        <div className="sm:col-span-2"><label className="label">Description</label>
          <input className="field" value={description} onChange={(e) => setDescription(e.target.value)}/></div>
        <div className="sm:col-span-2"><label className="label">Tags (comma-separated)</label>
          <input className="field" value={tags} onChange={(e) => setTags(e.target.value)}/></div>
        <div className="sm:col-span-2"><label className="label">Script body</label>
          <textarea className="field font-mono text-xs" rows={8}
            value={body} onChange={(e) => setBody(e.target.value)}/></div>
      </div>
      <div className="mt-2 flex justify-end gap-2">
        <button className="btn-ghost" onClick={onCancel}>Cancel</button>
        <button className="btn-primary" disabled={!name.trim() || !body.trim() || save.isPending}
          onClick={() => save.mutate()}>
          {save.isPending ? 'Saving…' : 'Save'}
        </button>
      </div>
    </div>
  );
}

// =========================================================================
//  Live Remote Desktop modal (unchanged behaviour)
// =========================================================================
function RemoteDesktop({ agentPcId, onClose }: { agentPcId: string; onClose: () => void }) {
  const token  = useAuth((s) => s.token);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const wsRef     = useRef<WebSocket | null>(null);
  const screenRef = useRef<{ w: number; h: number }>({ w: 1920, h: 1080 });
  const [stats, setStats] = useState({ connected: false, fps: 0, lastSeq: 0, lastBytes: 0 });
  const framesRef = useRef<number[]>([]);

  useEffect(() => {
    const base = (api.defaults.baseURL ?? '').replace(/\/$/, '')
      || `${window.location.origin}/api/v1`;
    const wsUrl = base.replace(/^http/i, 'ws') + `/rmm/viewer/ws?pcId=${encodeURIComponent(agentPcId)}&token=${encodeURIComponent(token ?? '')}`;
    const ws = new WebSocket(wsUrl);
    wsRef.current = ws;
    ws.onopen = () => setStats((s) => ({ ...s, connected: true }));
    ws.onclose = () => setStats((s) => ({ ...s, connected: false }));
    ws.onerror = () => setStats((s) => ({ ...s, connected: false }));
    ws.onmessage = (ev) => {
      try {
        const m = JSON.parse(ev.data);
        if (m.type !== 'view_frame') return;
        screenRef.current = { w: m.w, h: m.h };
        const now = performance.now();
        framesRef.current.push(now);
        while (framesRef.current[0] && now - framesRef.current[0] > 1000) framesRef.current.shift();
        setStats((s) => ({ ...s, lastSeq: m.seq, lastBytes: m.jpeg.length, fps: framesRef.current.length }));
        const img = new Image();
        img.onload = () => {
          const c = canvasRef.current;
          if (!c) return;
          c.width  = m.w;
          c.height = m.h;
          const ctx = c.getContext('2d');
          if (ctx) ctx.drawImage(img, 0, 0);
        };
        img.src = 'data:image/jpeg;base64,' + m.jpeg;
      } catch { /* ignore */ }
    };
    return () => { try { ws.close(); } catch { /* ignore */ } };
  }, [agentPcId, token]);

  function sendInput(msg: any) {
    const ws = wsRef.current;
    if (!ws || ws.readyState !== WebSocket.OPEN) return;
    ws.send(JSON.stringify({ type: 'remote_input', payload: msg }));
  }
  function canvasToScreen(e: React.MouseEvent) {
    const c = canvasRef.current;
    if (!c) return { x: 0, y: 0 };
    const r = c.getBoundingClientRect();
    const x = ((e.clientX - r.left) / r.width)  * screenRef.current.w;
    const y = ((e.clientY - r.top)  / r.height) * screenRef.current.h;
    return { x: Math.round(x), y: Math.round(y) };
  }
  function buttonName(b: number): 'left' | 'middle' | 'right' {
    return b === 0 ? 'left' : b === 1 ? 'middle' : 'right';
  }

  return (
    <div className="fixed inset-0 z-50 flex flex-col bg-slate-900 text-white">
      <header className="flex items-center justify-between border-b border-slate-700 bg-slate-800 px-4 py-2 text-xs">
        <div className="flex items-center gap-3">
          <span className={`inline-block h-2 w-2 rounded-full ${stats.connected ? 'bg-emerald-400' : 'bg-amber-400'}`} />
          <span>{stats.connected ? 'Live Connect — connected' : 'Connecting…'}</span>
          <span className="text-slate-400">{stats.fps} fps · {Math.round(stats.lastBytes / 1024)} KB · seq {stats.lastSeq}</span>
          <span className="text-slate-400">· {screenRef.current.w}×{screenRef.current.h}</span>
        </div>
        <button className="btn-ghost text-slate-100 hover:text-white" onClick={onClose}>
          <X size={13}/>Close session
        </button>
      </header>
      <div className="flex flex-1 items-center justify-center overflow-auto bg-black p-2"
        tabIndex={0}
        onKeyDown={(e) => { e.preventDefault(); sendInput({ kind: 'key_down', vk: e.keyCode }); }}
        onKeyUp={(e)   => { e.preventDefault(); sendInput({ kind: 'key_up',   vk: e.keyCode }); }}
      >
        <canvas
          ref={canvasRef}
          className="max-h-full max-w-full cursor-crosshair"
          onMouseMove={(e) => { const p = canvasToScreen(e); sendInput({ kind: 'mouse_move', ...p }); }}
          onMouseDown={(e) => { e.preventDefault(); const p = canvasToScreen(e); sendInput({ kind: 'mouse_down', button: buttonName(e.button), ...p }); }}
          onMouseUp={(e)   => { e.preventDefault(); const p = canvasToScreen(e); sendInput({ kind: 'mouse_up',   button: buttonName(e.button), ...p }); }}
          onContextMenu={(e) => e.preventDefault()}
          onWheel={(e) => { e.preventDefault(); sendInput({ kind: 'wheel', delta: -Math.sign(e.deltaY) * 120 }); }}
        />
      </div>
      <footer className="border-t border-slate-700 bg-slate-800 px-4 py-2 text-[11px] text-slate-400">
        Click inside the screen first so the keyboard focuses this window — shortcuts hit the remote PC, not your browser.
      </footer>
    </div>
  );
}

// =========================================================================
//  File transfer panel (unchanged behaviour)
// =========================================================================
function FileTransferPanel({ agentPcId, live }: { agentPcId: string; live: boolean }) {
  const qc = useQueryClient();
  const [pullPath, setPullPath] = useState('C:\\ProgramData\\ITAMLS\\logs\\rmm-agent.log');
  const [pushPath, setPushPath] = useState('');

  const pull = useMutation({
    mutationFn: () => api.post(`/rmm/pcs/${agentPcId}/file-pull`, { path: pullPath }).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rmm-cmds', agentPcId] }),
    onError: (e: any) => alert(e?.response?.data?.message ?? 'Pull failed'),
  });
  const push = useMutation({
    mutationFn: async (file: File) => {
      if (!pushPath) throw new Error('target path required');
      const b64 = await fileToBase64(file);
      return api.post(`/rmm/pcs/${agentPcId}/file-push`, { path: pushPath, base64: b64 }).then((r) => r.data);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rmm-cmds', agentPcId] }),
    onError: (e: any) => alert(e?.response?.data?.message ?? 'Push failed'),
  });

  const history = useQuery({
    queryKey: ['rmm-cmds', agentPcId],
    queryFn: () => api.get(`/rmm/pcs/${agentPcId}/commands`).then((r) => r.data),
    refetchInterval: 3_000,
  });
  const latestPull = (history.data ?? []).find((c: any) =>
    c.kind === 'FILE_PULL' && c.status === 'DONE' && c.stdout,
  );
  const downloadPull = () => {
    if (!latestPull?.stdout) return;
    try {
      const bytes = Uint8Array.from(atob(latestPull.stdout.trim()), (ch) => ch.charCodeAt(0));
      const blob = new Blob([bytes], { type: 'application/octet-stream' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = (latestPull.payload?.path ?? 'file').split(/[\\/]/).pop() || 'file';
      a.click();
      URL.revokeObjectURL(url);
    } catch { alert('Could not decode file content'); }
  };

  return (
    <>
      <h4 className="mb-1 flex items-center gap-1 text-[10px] font-semibold uppercase tracking-wider text-ink-300">
        <Upload size={10}/>File transfer
      </h4>
      <div className="space-y-3">
        <div>
          <label className="label">Pull a file from the PC</label>
          <div className="flex items-center gap-2">
            <input className="field flex-1 font-mono text-xs" value={pullPath}
              onChange={(e) => setPullPath(e.target.value)}/>
            <button className="btn-primary" disabled={!live || pull.isPending} onClick={() => pull.mutate()}>
              <Download size={11}/>{pull.isPending ? 'Pulling…' : 'Pull'}
            </button>
          </div>
          {latestPull && (
            <button className="mt-1 btn-ghost text-xs" onClick={downloadPull}>
              <Download size={11}/>Save last pulled file
            </button>
          )}
        </div>
        <div>
          <label className="label">Push a file to the PC</label>
          <input className="field mb-1 font-mono text-xs" placeholder="C:\path\on\pc\file.ext"
            value={pushPath} onChange={(e) => setPushPath(e.target.value)}/>
          <input type="file" className="field" disabled={!live || !pushPath}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) push.mutate(f); }}/>
        </div>
      </div>
    </>
  );
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const s = String(r.result ?? '');
      const comma = s.indexOf(',');
      resolve(comma >= 0 ? s.slice(comma + 1) : s);
    };
    r.onerror = reject;
    r.readAsDataURL(file);
  });
}

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}
