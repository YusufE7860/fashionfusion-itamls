import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { PageHeader } from '@/components/PageHeader';
import {
  Activity, Cpu, HardDrive, Monitor, Power, Terminal, Zap, Search, Plus, Trash2, Edit3,
  CheckSquare, Square, FileCode2, Play, X,
} from 'lucide-react';
import clsx from 'clsx';

/**
 * RMM — Remote Monitoring & Management.
 *
 * What's on the page:
 *   - Left panel: filterable PC list with online/offline filter, search by
 *     name/store, and a multi-select mode for bulk script runs.
 *   - Right panel when one PC is picked: live metrics + CPU sparkline,
 *     quick restart, saved-script picker, ad-hoc PowerShell runner, and
 *     a command history.
 *   - Modal: script library (create / edit / soft-delete), reachable from
 *     the "Manage scripts" button in the right panel header.
 *
 * Bulk run path (multi-select mode on):
 *   - Pick N PCs via the checkboxes on the left.
 *   - Click any script in the library modal → runs on all N in parallel.
 *   - Results surface in each PC's command history.
 */
type Conn = {
  id: string;
  agentPcId: string;
  isOnline: boolean;
  live?: boolean;
  lastSeenAt?: string;
  osName?: string;
  osVersion?: string;
  pcName?: string;
  scope?: 'STORE' | 'HQ';
  storeCode?: string;
  storeName?: string;
  departmentName?: string;
};

export function Rmm() {
  const conns = useQuery({
    queryKey: ['rmm-connections'],
    queryFn: () => api.get<Conn[]>('/rmm/connections').then((r) => r.data),
    refetchInterval: 5_000,
  });

  const [selected, setSelected] = useState<string | null>(null);
  const [search, setSearch]     = useState('');
  const [filter, setFilter]     = useState<'ALL' | 'ONLINE' | 'OFFLINE'>('ALL');
  const [multi, setMulti]       = useState(false);
  const [picked, setPicked]     = useState<Set<string>>(new Set());
  const [showScripts, setShowScripts] = useState(false);

  const online = conns.data?.filter((c) => c.isOnline).length ?? 0;
  const total  = conns.data?.length ?? 0;

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (conns.data ?? [])
      .filter((c) => filter === 'ALL' ? true : filter === 'ONLINE' ? c.isOnline : !c.isOnline)
      .filter((c) => {
        if (!q) return true;
        return [c.pcName, c.osName, c.storeCode, c.storeName, c.departmentName, c.agentPcId]
          .some((s) => (s ?? '').toLowerCase().includes(q));
      });
  }, [conns.data, filter, search]);

  function togglePick(pcId: string) {
    const next = new Set(picked);
    if (next.has(pcId)) next.delete(pcId); else next.add(pcId);
    setPicked(next);
  }

  return (
    <>
      <PageHeader
        title="RMM"
        subtitle={`${online} of ${total} agents online`}
        actions={
          <>
            <button className={clsx('btn-ghost', multi && 'bg-brand-50 text-brand-700')}
              onClick={() => { setMulti(!multi); setPicked(new Set()); }}>
              {multi ? <CheckSquare size={13}/> : <Square size={13}/>}
              {multi ? `Select ${picked.size}` : 'Multi-select'}
            </button>
            <button className="btn-ghost" onClick={() => setShowScripts(true)}>
              <FileCode2 size={13}/>Scripts
            </button>
          </>
        }
      />

      {/* Filter / search strip */}
      <section className="card mb-3 flex flex-wrap items-center gap-2 p-2">
        <div className="relative flex-1 min-w-[200px]">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-300"/>
          <input className="field pl-7 text-xs" placeholder="Search by PC / store / OS…"
            value={search} onChange={(e) => setSearch(e.target.value)}/>
        </div>
        <div className="inline-flex rounded-lg border border-ink-500 p-0.5 text-xs">
          {(['ALL', 'ONLINE', 'OFFLINE'] as const).map((f) => (
            <button key={f}
              className={clsx(
                'rounded px-2 py-0.5 font-medium transition-colors',
                filter === f ? 'bg-brand-500 text-white' : 'text-ink-200 hover:bg-ink-600',
              )}
              onClick={() => setFilter(f)}>
              {f}
            </button>
          ))}
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]">
        {/* ----------- Left: PC list ----------- */}
        <section className="card p-0">
          <ul className="max-h-[70vh] divide-y divide-ink-500/10 overflow-auto">
            {filtered.length === 0 && (
              <li className="p-6 text-center text-sm text-ink-300">
                {conns.data?.length === 0
                  ? 'No agents have connected yet. Install the updated agent on a PC and it will register here.'
                  : 'No PCs match the current filter.'}
              </li>
            )}
            {filtered.map((c) => {
              const checked = picked.has(c.agentPcId);
              const isSel = selected === c.agentPcId;
              return (
                <li key={c.id}>
                  <button className={clsx(
                    'flex w-full items-center gap-2 px-3 py-2 text-left transition-colors',
                    isSel ? 'bg-brand-50' : 'hover:bg-slate-50',
                  )}
                    onClick={() => {
                      if (multi) togglePick(c.agentPcId);
                      else setSelected(c.agentPcId);
                    }}>
                    {multi && (
                      checked
                        ? <CheckSquare size={14} className="text-brand-600 shrink-0"/>
                        : <Square     size={14} className="text-ink-300    shrink-0"/>
                    )}
                    <span className={clsx(
                      'inline-block h-2 w-2 shrink-0 rounded-full',
                      c.isOnline ? 'bg-emerald-500' : 'bg-slate-300',
                    )} />
                    <div className="flex-1 min-w-0">
                      <div className="truncate text-sm font-semibold">
                        {c.pcName ?? c.osName ?? c.agentPcId.slice(0, 8)}
                      </div>
                      <div className="truncate text-[10px] text-ink-300">
                        {c.scope === 'HQ'
                          ? `HQ · ${c.departmentName ?? '—'}`
                          : c.storeCode ? `${c.storeCode} — ${c.storeName ?? ''}` : '—'}
                        {' · '}
                        {c.isOnline ? 'Online' : c.lastSeenAt ? `last ${timeAgo(c.lastSeenAt)}` : 'never'}
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        </section>

        {/* ----------- Right: detail ----------- */}
        <section className="min-h-[400px]">
          {multi ? (
            <BulkPanel picked={[...picked]} onClear={() => setPicked(new Set())}
              onOpenScripts={() => setShowScripts(true)}/>
          ) : selected ? (
            <PcDetail agentPcId={selected} onOpenScripts={() => setShowScripts(true)}/>
          ) : (
            <div className="card p-6 text-center text-sm text-ink-300">
              Pick a PC on the left — or enable Multi-select to run a script on several at once.
            </div>
          )}
        </section>
      </div>

      {showScripts && (
        <ScriptLibrary
          onClose={() => setShowScripts(false)}
          runTargets={multi ? [...picked] : (selected ? [selected] : [])}
        />
      )}
    </>
  );
}

// =========================================================================
//  Bulk panel — shown in multi-select mode
// =========================================================================
function BulkPanel({ picked, onClear, onOpenScripts }: {
  picked: string[]; onClear: () => void; onOpenScripts: () => void;
}) {
  return (
    <section className="card p-6 text-center">
      <h3 className="text-lg font-semibold">
        {picked.length === 0 ? 'No PCs selected' : `${picked.length} PC(s) selected`}
      </h3>
      <p className="mt-1 text-xs text-ink-300">
        Multi-select lets you fan-out a script to many PCs in one click. Pick targets on the left, then open
        the script library.
      </p>
      <div className="mt-4 flex justify-center gap-2">
        <button className="btn-ghost" disabled={picked.length === 0} onClick={onClear}>
          <X size={13}/>Clear selection
        </button>
        <button className="btn-primary" disabled={picked.length === 0} onClick={onOpenScripts}>
          <FileCode2 size={13}/>Open scripts
        </button>
      </div>
    </section>
  );
}

// =========================================================================
//  PC detail — same as before, with an added "Open scripts" action
// =========================================================================
function PcDetail({ agentPcId, onOpenScripts }: { agentPcId: string; onOpenScripts: () => void }) {
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

  const [script, setScript] = useState('Get-Service | Where-Object Status -eq "Running" | Select Name,DisplayName -First 10');
  const runShell = useMutation({
    mutationFn: () => api.post(`/rmm/pcs/${agentPcId}/shell`, { script, interpreter: 'POWERSHELL' }).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rmm-cmds', agentPcId] }),
  });
  const restart = useMutation({
    mutationFn: () => api.post(`/rmm/pcs/${agentPcId}/restart`, { delaySeconds: 10 }).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['rmm-cmds', agentPcId] }),
  });

  const latest = metrics.data?.[0];
  const bytes = (n: any) => n ? `${(Number(n) / 1024 / 1024 / 1024).toFixed(1)} GB` : '—';

  return (
    <div className="space-y-4">
      <section className="card p-4">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="flex items-center gap-2">
              <span className={clsx(
                'inline-block h-2.5 w-2.5 rounded-full',
                info.data?.live ? 'bg-emerald-500' : 'bg-slate-300',
              )} />
              <h2 className="text-lg font-semibold">{info.data?.osName ?? agentPcId.slice(0, 10)}</h2>
            </div>
            <div className="mt-0.5 text-xs text-ink-300">
              {info.data?.osVersion} · agent {info.data?.agentVersion ?? '—'} · {info.data?.localIp ?? '—'}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button className="btn-ghost" onClick={onOpenScripts}>
              <FileCode2 size={13}/>Run script
            </button>
            <button className="btn-ghost" disabled={!info.data?.live || restart.isPending}
              onClick={() => { if (confirm('Restart this PC in 10 seconds?')) restart.mutate(); }}>
              <Power size={13}/>Restart
            </button>
          </div>
        </div>
      </section>

      <section className="card p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700"><Activity size={14}/>Metrics</h3>
        <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
          <StatBox icon={<Cpu size={14}/>} label="CPU" value={latest?.cpuPct != null ? `${latest.cpuPct.toFixed(0)}%` : '—'} />
          <StatBox icon={<Monitor size={14}/>} label="Memory"
            value={latest?.memUsedBytes ? `${bytes(latest.memUsedBytes)} / ${bytes(latest.memTotalBytes)}` : '—'} />
          <StatBox icon={<HardDrive size={14}/>} label="Disk"
            value={latest?.diskUsedBytes ? `${bytes(latest.diskUsedBytes)} / ${bytes(latest.diskTotalBytes)}` : '—'} />
          <StatBox icon={<Activity size={14}/>} label="User" value={latest?.loggedInUser ?? '—'} />
        </div>
        <div className="mt-4 h-16">
          <Sparkline values={(metrics.data ?? []).slice().reverse().map((m: any) => m.cpuPct ?? 0)} />
        </div>
        <p className="mt-1 text-[11px] text-ink-300">CPU % over the last ~5 minutes</p>
      </section>

      <section className="card p-4">
        <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700">
          <Terminal size={14}/>Ad-hoc PowerShell
        </h3>
        <textarea className="field font-mono text-xs" rows={5}
          value={script} onChange={(e) => setScript(e.target.value)} />
        <div className="mt-2 flex items-center gap-2">
          <button className="btn-primary" disabled={!info.data?.live || runShell.isPending}
            onClick={() => runShell.mutate()}>
            <Zap size={13}/>{runShell.isPending ? 'Running…' : 'Run'}
          </button>
          {!info.data?.live && <span className="text-xs text-amber-600">Agent is offline — command will queue until it reconnects.</span>}
        </div>
      </section>

      <section className="card p-4">
        <h3 className="mb-3 text-sm font-semibold text-slate-700">Command history</h3>
        <ul className="space-y-1 text-xs">
          {(history.data ?? []).length === 0 && <li className="text-ink-300">No commands yet.</li>}
          {history.data?.map((c: any) => (
            <li key={c.id} className="rounded border border-ink-500/10 bg-slate-50/40 p-2">
              <div className="mb-1 flex items-center justify-between">
                <span className="font-mono text-[10px]">{c.kind} · {c.status}</span>
                <span className="text-[10px] text-ink-300">
                  {new Date(c.queuedAt).toLocaleTimeString()} · {c.issuedBy?.fullName ?? ''}
                </span>
              </div>
              {(c.kind === 'SHELL' || c.kind === 'SCRIPT') && (
                <pre className="max-h-20 overflow-auto whitespace-pre-wrap font-mono text-[10px] text-ink-200">
                  {(c.payload as any)?.script?.slice(0, 300) ?? ''}
                </pre>
              )}
              {(c.stdout || c.stderr) && (
                <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap font-mono text-[10px]">
                  {c.stdout}{c.stderr && <span className="text-rose-500">{'\n' + c.stderr}</span>}
                </pre>
              )}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

// =========================================================================
//  Script library modal — list, create/edit, run on targets
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
            <h3 className="text-base font-semibold">Script library</h3>
            <p className="text-xs text-ink-300">
              {runTargets.length === 0
                ? 'Browse or manage saved scripts. Pick a PC (or multiple in multi-select) to enable Run.'
                : `Run against ${runTargets.length} selected PC(s).`}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button className="btn-ghost" onClick={() => setShowNew(true)}>
              <Plus size={13}/>New
            </button>
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
              No scripts yet. Click <b>New</b> to create one.
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
                    title={runTargets.length === 0 ? 'Select a PC first' : `Run on ${runTargets.length} PC(s)`}
                    onClick={() => {
                      if (!confirm(`Run "${s.name}" on ${runTargets.length} PC(s)?`)) return;
                      runScript.mutate(s.id);
                    }}>
                    <Play size={12}/>Run
                  </button>
                  <button className="btn-ghost" onClick={() => setEditing(s)}>
                    <Edit3 size={12}/>
                  </button>
                  <button className="btn-ghost text-rose-600"
                    onClick={() => { if (confirm(`Remove "${s.name}" from the library?`)) removeScript.mutate(s.id); }}>
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

// =========================================================================
//  Script editor — create or edit a saved script
// =========================================================================
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
          {initial?.id ? `Edit "${initial.name}"` : 'New script'}
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
        <div className="sm:col-span-2"><label className="label">Description <span className="text-ink-400">(optional)</span></label>
          <input className="field" value={description} onChange={(e) => setDescription(e.target.value)}/></div>
        <div className="sm:col-span-2"><label className="label">Tags <span className="text-ink-400">(comma-separated, optional)</span></label>
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
//  Utility components
// =========================================================================
function StatBox({ icon, label, value }: { icon: any; label: string; value: string }) {
  return (
    <div className="rounded border border-ink-500/10 p-2">
      <div className="flex items-center gap-1 text-[10px] uppercase tracking-wider text-ink-300">{icon}{label}</div>
      <div className="mt-0.5 text-sm font-semibold text-ink-100 truncate">{value}</div>
    </div>
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

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60_000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h`;
  return `${Math.floor(h / 24)}d`;
}
