import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { PageHeader } from '@/components/PageHeader';
import { useAuth } from '@/store/auth';
import {
  AlertTriangle, Copy, Download, KeyRound, MonitorSmartphone, PlusCircle, RefreshCw, Trash2, Terminal, Store, Building2,
} from 'lucide-react';

type StoreT = { id: string; code: string; name: string };
type Dept   = { id: string; code: string; name: string };
type Token = {
  id: string; token: string; scope: string;
  storeId?: string; departmentId?: string;
  usesRemaining: number; expiresAt?: string; createdAt: string;
  revokedAt?: string; lastUsedAt?: string;
};
type Pc = {
  id: string; name: string; role: string; scope: string;
  storeId?: string; departmentId?: string;
  store?: StoreT;
  department?: Dept | null;
  agentVersion?: string; osVersion?: string; ipAddress?: string;
  lastSeenAt?: string; lastInventoryAt?: string; lastBackupAt?: string;
  agentInstalledAt?: string;
  _count?: { runs: number };
};

type Mode = 'STORE' | 'HQ';

export function AgentEnrollment() {
  const qc = useQueryClient();
  const token = useAuth((s) => s.token);
  const hasPerm = useAuth((s) => s.hasPermission);
  const canManage = hasPerm('agents:manage');

  const [mode, setMode] = useState<Mode>('STORE');
  const stores  = useQuery({ queryKey: ['stores'],       queryFn: () => api.get<StoreT[]>('/stores').then((r) => r.data) });
  const depts   = useQuery({ queryKey: ['departments'],  queryFn: () => api.get<Dept[]>('/departments').then((r) => r.data) });
  const pcs     = useQuery({ queryKey: ['agent-pcs'],    queryFn: () => api.get<Pc[]>('/agents/pcs').then((r) => r.data) });
  const tokens  = useQuery({ queryKey: ['agent-tokens'], queryFn: () => api.get<Token[]>('/agents/enrollment-tokens').then((r) => r.data) });

  const [storeId, setStoreId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [uses, setUses] = useState(5);
  const [hours, setHours] = useState(24);
  const [lastIssued, setLastIssued] = useState<Token | null>(null);
  const [selectedPc, setSelectedPc] = useState<string | null>(null);

  const issue = useMutation({
    mutationFn: () => api.post<Token>('/agents/enrollment-tokens', {
      scope: mode,
      storeId:      mode === 'STORE' ? storeId : undefined,
      departmentId: mode === 'HQ'    ? departmentId : undefined,
      usesRemaining: uses,
      expiresInHours: hours,
    }).then((r) => r.data),
    onSuccess: (t) => { setLastIssued(t); qc.invalidateQueries({ queryKey: ['agent-tokens'] }); },
  });

  const revoke = useMutation({
    mutationFn: (id: string) => api.delete(`/agents/enrollment-tokens/${id}`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['agent-tokens'] }),
  });

  const apiBase = api.defaults.baseURL ?? '';
  const oneLiner = useMemo(() => {
    const tk = lastIssued?.token ?? '<TOKEN>';
    return `iwr ${apiBase}/tools/install-pc.ps1 -UseB | iex; Install-ITAMLSAgent -Token '${tk}' -Api '${apiBase}'`;
  }, [lastIssued, apiBase]);

  function copy(text: string) { navigator.clipboard.writeText(text); }
  function downloadCmd() {
    fetch(`${apiBase}/tools/install-itamlsagent.cmd`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.blob())
      .then((b) => {
        const url = URL.createObjectURL(b);
        const a = document.createElement('a');
        a.href = url; a.download = 'Install-ITAMLSAgent.cmd'; a.click();
      });
  }

  const software = useQuery({
    queryKey: ['pc-software', selectedPc],
    queryFn: () => api.get<any[]>(`/agents/pcs/${selectedPc}/software`).then((r) => r.data),
    enabled: !!selectedPc,
  });

  const canIssue = mode === 'STORE' ? !!storeId : !!departmentId;

  const [pcTab, setPcTab] = useState<'ALL' | 'STORE' | 'HQ'>('ALL');
  const filteredPcs = useMemo(() => {
    if (!pcs.data) return [];
    if (pcTab === 'ALL') return pcs.data;
    return pcs.data.filter((p) => p.scope === pcTab);
  }, [pcs.data, pcTab]);

  return (
    <>
      <PageHeader
        title="PC Agent Enrollment"
        subtitle="Generate a scoped token, run the one-liner on each PC, agents auto-register with inventory + backups"
        actions={
          <button className="btn-ghost" onClick={() => { pcs.refetch(); tokens.refetch(); }}>
            <RefreshCw size={13} />Refresh
          </button>
        }
      />

      {!canManage && (
        <div className="mb-4 flex items-start gap-3 rounded-lg border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900">
          <AlertTriangle size={16} className="mt-0.5 shrink-0" />
          <div>
            <div className="font-semibold">You can view but not issue tokens.</div>
            <div className="mt-1 text-xs">
              Sign out and back in to refresh your session, or ask an admin to re-run the seed if the <code>agents:manage</code> permission hasn't been applied yet.
            </div>
          </div>
        </div>
      )}

      {/* ---------- Issue token ---------- */}
      <section className="card mb-4 p-4">
        <div className="mb-3 flex items-center gap-2">
          <KeyRound size={16} className="text-brand-600" />
          <h2 className="text-sm font-semibold text-slate-700">Issue a new enrollment token</h2>
        </div>

        {/* Store / HQ toggle */}
        <div className="mb-3 inline-flex rounded-lg border border-ink-500 p-1">
          <button
            className={`flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${mode === 'STORE' ? 'bg-brand-500 text-white' : 'text-ink-200 hover:bg-ink-600'}`}
            onClick={() => setMode('STORE')}>
            <Store size={13} />Store PC
          </button>
          <button
            className={`flex items-center gap-1 rounded-md px-3 py-1.5 text-xs font-medium transition-colors ${mode === 'HQ' ? 'bg-brand-500 text-white' : 'text-ink-200 hover:bg-ink-600'}`}
            onClick={() => setMode('HQ')}>
            <Building2 size={13} />HQ PC
          </button>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          {mode === 'STORE' ? (
            <div>
              <label className="label">Store</label>
              <select className="field" value={storeId} onChange={(e) => setStoreId(e.target.value)}>
                <option value="">Pick a store…</option>
                {stores.data?.map((s) => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
              </select>
            </div>
          ) : (
            <div>
              <label className="label">HQ Department</label>
              <select className="field" value={departmentId} onChange={(e) => setDepartmentId(e.target.value)}>
                <option value="">Pick a department…</option>
                {depts.data?.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
              </select>
            </div>
          )}
          <div>
            <label className="label">Uses allowed</label>
            <input type="number" className="field" min={1} max={100}
              value={uses} onChange={(e) => setUses(+e.target.value)} />
          </div>
          <div>
            <label className="label">Expires in (hours)</label>
            <input type="number" className="field" min={1} max={720}
              value={hours} onChange={(e) => setHours(+e.target.value)} />
          </div>
          <div className="flex items-end">
            <button className="btn-primary w-full" disabled={!canIssue || issue.isPending}
              onClick={() => issue.mutate()}>
              <PlusCircle size={14} />{issue.isPending ? 'Issuing…' : 'Issue token'}
            </button>
          </div>
        </div>
        {issue.isError && (
          <div className="mt-2 text-xs text-rose-600">
            {(issue.error as any)?.response?.status === 403
              ? 'Permission denied — see banner above.'
              : ((issue.error as any)?.response?.data?.message ?? 'Failed to issue token')}
          </div>
        )}

        {lastIssued && (
          <div className="mt-4 rounded-lg border border-brand-200 bg-brand-50 p-3">
            <div className="mb-2 flex items-center justify-between">
              <div>
                <div className="text-xs uppercase tracking-wider text-brand-700">Token ({lastIssued.scope})</div>
                <div className="font-mono text-xl font-bold tracking-widest text-ink-50">{lastIssued.token}</div>
                <div className="mt-1 text-[11px] text-ink-300">
                  Uses left: {lastIssued.usesRemaining} · Expires: {lastIssued.expiresAt ? new Date(lastIssued.expiresAt).toLocaleString() : 'never'}
                </div>
              </div>
              <button className="btn-ghost" onClick={() => copy(lastIssued.token)}>
                <Copy size={13} />Copy token
              </button>
            </div>

            <div className="mt-3">
              <div className="mb-1 flex items-center gap-2 text-xs font-medium text-ink-100">
                <Terminal size={12} />PowerShell one-liner (paste into elevated PS on the PC)
              </div>
              <div className="flex items-center gap-2">
                <textarea className="field font-mono text-[11px]" rows={2} readOnly value={oneLiner} />
                <button className="btn-ghost" onClick={() => copy(oneLiner)}><Copy size={13} /></button>
              </div>
            </div>

            <div className="mt-3 flex items-center gap-2 text-xs">
              <button className="btn-ghost" onClick={downloadCmd}>
                <Download size={12} />Download double-click installer (.cmd)
              </button>
              <span className="text-ink-300">— for non-technical staff, prompts for token + API URL</span>
            </div>
          </div>
        )}
      </section>

      {/* ---------- Active tokens ---------- */}
      <section className="card mb-4 p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Enrollment tokens</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="th text-left">Token</th>
                <th className="th text-left">Scope</th>
                <th className="th text-left">Target</th>
                <th className="th text-right">Uses left</th>
                <th className="th text-left">Expires</th>
                <th className="th text-left">Last used</th>
                <th className="th text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {tokens.data?.map((t) => {
                const store = t.storeId      ? stores.data?.find((s) => s.id === t.storeId) : undefined;
                const dept  = t.departmentId ? depts.data?.find((d) => d.id === t.departmentId) : undefined;
                const dead = t.revokedAt || t.usesRemaining <= 0 || (t.expiresAt && new Date(t.expiresAt) < new Date());
                return (
                  <tr key={t.id} className={dead ? 'text-ink-300' : ''}>
                    <td className="py-2 font-mono text-xs">{t.token}</td>
                    <td className="py-2 text-xs">
                      <span className={`rounded px-2 py-0.5 text-[11px] ${t.scope === 'HQ' ? 'bg-violet-50 text-violet-700 ring-1 ring-violet-200' : 'bg-sky-50 text-sky-700 ring-1 ring-sky-200'}`}>
                        {t.scope}
                      </span>
                    </td>
                    <td className="py-2 text-xs">
                      {store ? `${store.code} — ${store.name}` : dept ? `HQ / ${dept.name}` : '—'}
                    </td>
                    <td className="py-2 text-right text-xs">{t.usesRemaining}</td>
                    <td className="py-2 text-xs">{t.expiresAt ? new Date(t.expiresAt).toLocaleString() : '—'}</td>
                    <td className="py-2 text-xs">{t.lastUsedAt ? new Date(t.lastUsedAt).toLocaleString() : '—'}</td>
                    <td className="py-2 text-right">
                      {canManage && !dead && (
                        <button className="btn-ghost text-rose-500" onClick={() => revoke.mutate(t.id)}>
                          <Trash2 size={12} />Revoke
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
              {tokens.data?.length === 0 && (
                <tr><td colSpan={7} className="py-4 text-center text-xs text-ink-300">No tokens issued yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {/* ---------- Enrolled PCs ---------- */}
      <section className="card p-4">
        <div className="mb-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <MonitorSmartphone size={16} className="text-brand-600" />
            <h2 className="text-sm font-semibold text-slate-700">Enrolled PCs</h2>
          </div>
          <div className="inline-flex rounded-lg border border-ink-500 p-1 text-xs">
            {(['ALL', 'STORE', 'HQ'] as const).map((t) => (
              <button key={t}
                className={`rounded-md px-3 py-1 font-medium transition-colors ${pcTab === t ? 'bg-brand-500 text-white' : 'text-ink-200 hover:bg-ink-600'}`}
                onClick={() => setPcTab(t)}>{t}</button>
            ))}
          </div>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="th text-left">Scope</th>
                <th className="th text-left">Location</th>
                <th className="th text-left">PC</th>
                <th className="th text-left">OS</th>
                <th className="th text-left">IP</th>
                <th className="th text-left">Last seen</th>
                <th className="th text-left">Last inventory</th>
                <th className="th text-left">Last backup</th>
                <th className="th text-right">Software</th>
              </tr>
            </thead>
            <tbody>
              {filteredPcs.map((pc) => (
                <tr key={pc.id} className="border-b border-ink-500/20">
                  <td className="py-2">
                    <span className={`rounded px-2 py-0.5 text-[11px] ${pc.scope === 'HQ' ? 'bg-violet-50 text-violet-700 ring-1 ring-violet-200' : 'bg-sky-50 text-sky-700 ring-1 ring-sky-200'}`}>
                      {pc.scope}
                    </span>
                  </td>
                  <td className="py-2 text-xs">
                    {pc.store ? `${pc.store.code} — ${pc.store.name}` : pc.department ? `HQ / ${pc.department.name}` : '—'}
                  </td>
                  <td className="py-2 text-xs font-semibold">{pc.name}</td>
                  <td className="py-2 text-xs">{pc.osVersion ?? '—'}</td>
                  <td className="py-2 text-xs font-mono">{pc.ipAddress ?? '—'}</td>
                  <td className="py-2 text-xs">{pc.lastSeenAt ? new Date(pc.lastSeenAt).toLocaleString() : '—'}</td>
                  <td className="py-2 text-xs">{pc.lastInventoryAt ? new Date(pc.lastInventoryAt).toLocaleString() : '—'}</td>
                  <td className="py-2 text-xs">{pc.lastBackupAt ? new Date(pc.lastBackupAt).toLocaleString() : '—'}</td>
                  <td className="py-2 text-right">
                    <button className="btn-ghost" onClick={() => setSelectedPc(pc.id === selectedPc ? null : pc.id)}>
                      {pc.id === selectedPc ? 'Hide' : 'View'}
                    </button>
                  </td>
                </tr>
              ))}
              {filteredPcs.length === 0 && (
                <tr><td colSpan={9} className="py-4 text-center text-xs text-ink-300">No PCs enrolled in this scope yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {selectedPc && (
          <div className="mt-4 rounded-lg border border-ink-500 bg-slate-50 p-3">
            <h3 className="mb-2 text-sm font-semibold text-slate-700">Installed software</h3>
            {software.isLoading && <div className="text-xs text-ink-300">Loading…</div>}
            {software.data && (
              <div className="max-h-96 overflow-y-auto">
                <table className="w-full text-xs">
                  <thead className="sticky top-0 bg-slate-100">
                    <tr>
                      <th className="th text-left">Name</th>
                      <th className="th text-left">Version</th>
                      <th className="th text-left">Publisher</th>
                      <th className="th text-left">Source</th>
                    </tr>
                  </thead>
                  <tbody>
                    {software.data.map((s: any) => (
                      <tr key={s.id}>
                        <td className="py-1">{s.name}</td>
                        <td className="py-1 font-mono">{s.version ?? '—'}</td>
                        <td className="py-1">{s.publisher ?? '—'}</td>
                        <td className="py-1">{s.source}</td>
                      </tr>
                    ))}
                    {software.data.length === 0 && (
                      <tr><td colSpan={4} className="py-2 text-center text-ink-300">No inventory reported yet.</td></tr>
                    )}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </section>
    </>
  );
}
