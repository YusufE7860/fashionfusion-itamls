import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { useAuth } from '@/store/auth';
import { PageHeader } from '@/components/PageHeader';
import { Plus, X, Save, Trash2, HardDrive, Server, Download, CheckCircle2, XCircle, Clock, Copy } from 'lucide-react';
import clsx from 'clsx';

export function StoreBackups() {
  const { id } = useParams<{ id: string }>();
  const qc = useQueryClient();
  const hasPerm = useAuth((s) => s.hasPermission);
  const canManage = hasPerm('backups:manage');

  const data = useQuery({
    queryKey: ['store-backups', id],
    queryFn: () => api.get(`/stores/${id}/backups`).then((r) => r.data),
    enabled: !!id,
    refetchInterval: 30_000,
  });

  const [showNew, setShowNew] = useState(false);
  const [newPc, setNewPc] = useState({ name: '', role: 'TILL' as 'TILL' | 'BACKOFFICE', paths: '' });
  const addPc = useMutation({
    mutationFn: () => api.post(`/stores/${id}/pcs`, {
      name: newPc.name, role: newPc.role,
      backupPaths: newPc.paths.split('\n').map((s) => s.trim()).filter(Boolean),
    }).then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['store-backups', id] });
                       setShowNew(false); setNewPc({ name: '', role: 'TILL', paths: '' }); },
  });

  const updateJob = useMutation({
    mutationFn: (body: any) => api.patch(`/stores/${id}/backup-job`, body).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['store-backups', id] }),
  });

  if (!data.data) return <div className="text-ink-200">Loading…</div>;
  const d = data.data;
  const agentUrl = `${api.defaults.baseURL}/tools/backup.ps1`;

  return (
    <>
      <PageHeader
        title={`Backups — ${d.storeCode} ${d.storeName}`}
        subtitle="Daily database file uploads from every till and back-office PC"
        actions={
          <>
            <Link to={`/stores/${id}`} className="btn-ghost">Back to store</Link>
            {canManage && <button className="btn-primary" onClick={() => setShowNew(!showNew)}>
              {showNew ? <><X size={14}/>Cancel</> : <><Plus size={14}/>Add PC</>}
            </button>}
          </>
        }
      />

      {/* Job config */}
      <div className="card mb-4 p-4">
        <h3 className="mb-3 text-sm font-semibold text-white">Backup job</h3>
        <div className="grid grid-cols-3 gap-3">
          <div><label className="label">Schedule (cron)</label>
            <input className="field font-mono" defaultValue={d.job.scheduleCron}
              onBlur={(e) => e.target.value !== d.job.scheduleCron && updateJob.mutate({ scheduleCron: e.target.value })} /></div>
          <div><label className="label">Retention (days)</label>
            <input type="number" min={1} className="field" defaultValue={d.job.retentionDays}
              onBlur={(e) => +e.target.value !== d.job.retentionDays && updateJob.mutate({ retentionDays: +e.target.value })} /></div>
          <div><label className="label">Enabled</label>
            <select className="field" defaultValue={String(d.job.isActive)}
              onChange={(e) => updateJob.mutate({ isActive: e.target.value === 'true' })}>
              <option value="true">Yes</option><option value="false">Paused</option>
            </select></div>
        </div>
        <p className="mt-2 text-xs text-ink-200">
          The cron on each agent is informational — the actual schedule is set in Kaseya VSA where you deploy the script.
        </p>
      </div>

      {/* Add PC form */}
      {showNew && (
        <div className="card mb-4 p-4">
          <h3 className="mb-3 text-sm font-semibold text-white">Add PC to backup</h3>
          <div className="grid grid-cols-3 gap-3">
            <div><label className="label">PC name</label>
              <input className="field font-mono" value={newPc.name} onChange={(e) => setNewPc({ ...newPc, name: e.target.value })} placeholder="POS1 / POS2 / BackOffice" /></div>
            <div><label className="label">Role</label>
              <select className="field" value={newPc.role} onChange={(e) => setNewPc({ ...newPc, role: e.target.value as any })}>
                <option value="TILL">Till</option>
                <option value="BACKOFFICE">Back office</option>
              </select></div>
            <div className="col-span-3"><label className="label">Backup paths (one per line)</label>
              <textarea className="field font-mono" rows={3} value={newPc.paths}
                onChange={(e) => setNewPc({ ...newPc, paths: e.target.value })}
                placeholder="C:\POS\data.db&#10;C:\Users\Public\Documents\config.xml" /></div>
          </div>
          <button className="btn-primary mt-3" disabled={!newPc.name || addPc.isPending} onClick={() => addPc.mutate()}>
            {addPc.isPending ? 'Saving…' : 'Save'}
          </button>
        </div>
      )}

      {/* PC list */}
      <div className="mb-6 space-y-3">
        {d.pcs.map((pc: any) => <PcRow key={pc.id} pc={pc} storeId={id!} canManage={canManage} />)}
        {d.pcs.length === 0 && (
          <div className="card p-6 text-center text-sm text-ink-200">
            <Server className="mx-auto mb-2 text-ink-200" size={22}/>
            No PCs registered yet. Deploy the backup agent (below) with a new PC name, or add one manually.
          </div>
        )}
      </div>

      {/* Deployment instructions */}
      <div className="card overflow-hidden">
        <header className="border-b border-ink-500/40 px-4 py-3 text-sm font-semibold text-white">
          Deploy the agent to your PCs (Kaseya VSA)
        </header>
        <div className="p-4 text-sm text-ink-100">
          <ol className="list-decimal space-y-2 pl-5">
            <li>Generate a <b>Backup</b> API key from <Link to="/admin/api-keys" className="text-brand-300 hover:underline">Admin → API Keys</Link> (label: <code className="rounded bg-ink-900/60 px-1 text-brand-300">Backup agent</code>).</li>
            <li>In Kaseya, add a Run Procedure with a single <b>Execute Shell Command</b> step:
              <div className="mt-2 flex items-center gap-2">
                <code className="flex-1 overflow-auto rounded bg-ink-900/60 px-3 py-2 font-mono text-[11px]">
                  {`powershell -ExecutionPolicy Bypass -NoProfile -WindowStyle Hidden -Command "$t=$env:TEMP+'\\backup.ps1'; iwr '${agentUrl}' -OutFile $t; & $t -ApiBase '${api.defaults.baseURL}' -ApiKey 'PASTE_KEY_HERE' -StoreCode '${d.storeCode}' -PcName 'POS1'"`}
                </code>
                <button className="btn-ghost"
                  onClick={() => navigator.clipboard.writeText(
                    `powershell -ExecutionPolicy Bypass -NoProfile -WindowStyle Hidden -Command "$t=$env:TEMP+'\\backup.ps1'; iwr '${agentUrl}' -OutFile $t; & $t -ApiBase '${api.defaults.baseURL}' -ApiKey 'PASTE_KEY_HERE' -StoreCode '${d.storeCode}' -PcName 'POS1'"`,
                  )}><Copy size={12}/></button>
              </div>
            </li>
            <li>Change <code className="text-brand-300">POS1</code> per-machine (POS2, BackOffice, etc.) — each PC will register itself the first time it runs.</li>
            <li>Schedule daily at whatever time suits your stores. Configure the paths above.</li>
          </ol>
        </div>
      </div>
    </>
  );
}

function PcRow({ pc, storeId, canManage }: { pc: any; storeId: string; canManage: boolean }) {
  const qc = useQueryClient();
  const token = useAuth((s) => s.token);
  const [editing, setEditing] = useState(false);
  const [paths, setPaths] = useState((pc.backupPaths ?? []).join('\n'));

  const save = useMutation({
    mutationFn: () => api.patch(`/stores/${storeId}/pcs/${encodeURIComponent(pc.name)}`, {
      backupPaths: paths.split('\n').map((s: string) => s.trim()).filter(Boolean),
    }).then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['store-backups', storeId] }); setEditing(false); },
  });
  const toggle = useMutation({
    mutationFn: () => api.patch(`/stores/${storeId}/pcs/${encodeURIComponent(pc.name)}`,
      { isActive: !pc.isActive }).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['store-backups', storeId] }),
  });
  const remove = useMutation({
    mutationFn: () => api.delete(`/store-pcs/${pc.id}`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['store-backups', storeId] }),
  });

  const lr = pc.lastRun;
  const stale = pc.lastBackupAt
    ? (Date.now() - new Date(pc.lastBackupAt).getTime()) > 36 * 3600 * 1000
    : true;
  const tone = !pc.isActive ? 'text-ink-200' : lr?.status === 'SUCCESS' && !stale ? 'text-emerald-300'
    : lr?.status === 'FAILED' ? 'text-rose-300' : 'text-amber-300';

  function downloadRun(runId: string) {
    fetch(`${api.defaults.baseURL}/backups/${runId}/download`, {
      headers: { Authorization: `Bearer ${token}` }, redirect: 'follow',
    }).then((r) => r.blob()).then((b) => {
      const a = document.createElement('a');
      a.href = URL.createObjectURL(b); a.download = `${pc.name}-${runId}.zip`; a.click();
    });
  }

  return (
    <div className="card overflow-hidden">
      <header className="flex items-center justify-between border-b border-ink-500/40 px-4 py-3">
        <div className="flex items-center gap-3">
          <HardDrive size={16} className={tone}/>
          <div>
            <div className="font-mono text-sm text-white">{pc.name}</div>
            <div className="text-[11px] uppercase tracking-wider text-ink-200">{pc.role}</div>
          </div>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <span className={clsx('pill', pc.isActive ? 'pill-green' : 'pill-slate')}>
            {pc.isActive ? 'Active' : 'Paused'}
          </span>
          <StatusPill run={lr} stale={stale} hasPaths={(pc.backupPaths?.length ?? 0) > 0} />
          {canManage && (
            <>
              <button className="btn-ghost" onClick={() => setEditing(!editing)}>Edit paths</button>
              <button className="btn-ghost" onClick={() => toggle.mutate()}>{pc.isActive ? 'Pause' : 'Resume'}</button>
              <button className="btn-ghost text-rose-300" onClick={() => { if (confirm(`Remove ${pc.name}?`)) remove.mutate(); }}>
                <Trash2 size={12}/>
              </button>
            </>
          )}
        </div>
      </header>

      {editing && (
        <div className="border-b border-ink-500/40 bg-ink-700/20 p-4">
          <label className="label">Backup paths (one per line)</label>
          <textarea className="field font-mono" rows={4} value={paths} onChange={(e) => setPaths(e.target.value)} />
          <button className="btn-primary mt-2" onClick={() => save.mutate()} disabled={save.isPending}>
            <Save size={12}/>{save.isPending ? 'Saving…' : 'Save paths'}
          </button>
        </div>
      )}

      <div className="grid grid-cols-3 gap-4 p-4 text-sm">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-ink-200">Last backup</div>
          <div className="text-white">{pc.lastBackupAt ? new Date(pc.lastBackupAt).toLocaleString() : 'never'}</div>
        </div>
        <div>
          <div className="text-[10px] font-bold uppercase tracking-wider text-ink-200">Size</div>
          <div className="font-mono text-white">{lr?.sizeBytes ? formatSize(lr.sizeBytes) : '—'}</div>
        </div>
        <div className="text-right">
          {lr?.status === 'SUCCESS' && (
            <button className="btn-primary" onClick={() => downloadRun(lr.id)}>
              <Download size={12}/>Download latest
            </button>
          )}
        </div>
      </div>

      {(pc.backupPaths?.length ?? 0) === 0 && (
        <div className="border-t border-ink-500/40 bg-amber-500/10 px-4 py-2 text-xs text-amber-200">
          ⚠ No backup paths configured — the agent will register but do nothing until you set paths here.
        </div>
      )}
    </div>
  );
}

function StatusPill({ run, stale, hasPaths }: { run: any; stale: boolean; hasPaths: boolean }) {
  if (!hasPaths) return <span className="pill-slate"><Clock size={11}/>Unconfigured</span>;
  if (!run) return <span className="pill-amber"><Clock size={11}/>Not run yet</span>;
  if (run.status === 'SUCCESS' && !stale) return <span className="pill-green"><CheckCircle2 size={11}/>OK</span>;
  if (run.status === 'SUCCESS' && stale)   return <span className="pill-amber"><Clock size={11}/>Stale</span>;
  if (run.status === 'FAILED')             return <span className="pill-red"><XCircle size={11}/>Failed</span>;
  return <span className="pill-amber"><Clock size={11}/>Running</span>;
}

function formatSize(bytesStr: string) {
  const b = Number(bytesStr);
  if (!isFinite(b) || b === 0) return '—';
  if (b > 1e9) return `${(b / 1e9).toFixed(2)} GB`;
  if (b > 1e6) return `${(b / 1e6).toFixed(2)} MB`;
  if (b > 1e3) return `${(b / 1e3).toFixed(1)} KB`;
  return `${b} B`;
}
