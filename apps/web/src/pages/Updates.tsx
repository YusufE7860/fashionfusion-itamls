import { useEffect, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { PageHeader } from '@/components/PageHeader';
import { RefreshCw, Download, CheckCircle2, AlertTriangle, GitCommitVertical } from 'lucide-react';

export function Updates() {
  const qc = useQueryClient();
  const [showLog, setShowLog] = useState(false);

  const status = useQuery({
    queryKey: ['update-status'],
    queryFn: () => api.get('/admin/updates/status').then((r) => r.data),
    // Poll every 3s while updating (live progress), otherwise every 5 minutes so
    // the page + sidebar badge auto-detect a fresh push to GitHub.
    refetchInterval: (q) => (q.state.data?.updating ? 3000 : 5 * 60_000),
  });

  const log = useQuery({
    queryKey: ['update-log'],
    queryFn: () => api.get('/admin/updates/log').then((r) => r.data),
    enabled: showLog || !!status.data?.updating,
    refetchInterval: (q) => (status.data?.updating ? 2000 : false),
  });

  const install = useMutation({
    mutationFn: () => api.post('/admin/updates/install').then((r) => r.data),
    onSuccess: () => {
      setShowLog(true);
      qc.invalidateQueries({ queryKey: ['update-status'] });
    },
    onError: (e: any) => alert(e.response?.data?.message ?? 'Could not start updater'),
  });

  useEffect(() => {
    if (status.data?.updating) setShowLog(true);
  }, [status.data?.updating]);

  if (!status.data) return <div className="text-ink-200">Loading…</div>;

  if (!status.data.ready) {
    return (
      <>
        <PageHeader title="Updates" subtitle="In-app self-update from GitHub" />
        <div className="card border-amber-500/30 bg-amber-500/5 p-4">
          <div className="flex items-center gap-2 text-amber-300">
            <AlertTriangle size={16}/>
            <span className="font-semibold">Updater not available</span>
          </div>
          <p className="mt-2 text-sm text-ink-200">{status.data.message}</p>
        </div>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="Updates"
        subtitle="Check GitHub and install the latest version with one click"
        actions={
          <button className="btn-ghost" onClick={() => status.refetch()} disabled={status.isFetching}>
            <RefreshCw size={14} className={status.isFetching ? 'animate-spin' : ''}/>
            Check now
          </button>
        }
      />

      {/* Current version card */}
      <div className="card mb-4 p-5">
        <div className="mb-1 flex items-center gap-2 text-[11px] font-bold uppercase tracking-widest text-ink-200">
          <GitCommitVertical size={12}/> Currently installed
        </div>
        <div className="flex items-center gap-3">
          <code className="rounded bg-ink-900/60 px-2 py-1 font-mono text-brand-300">{status.data.currentCommit}</code>
          <span className="text-sm text-white">{status.data.currentTitle}</span>
        </div>
        <div className="mt-1 text-xs text-ink-200">
          Branch <b className="text-white">{status.data.branch}</b>
          {status.data.currentDate && <> · {new Date(status.data.currentDate).toLocaleString()}</>}
        </div>
      </div>

      {/* Update available banner */}
      {status.data.available ? (
        <div className="card border-brand-500/40 bg-brand-500/5 mb-4 p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="mb-1 flex items-center gap-2 text-sm font-semibold text-brand-300">
                <Download size={14}/>New version available
              </div>
              <div className="text-sm text-ink-100">
                Latest on <b>origin/{status.data.branch}</b> is{' '}
                <code className="rounded bg-ink-900/60 px-1 py-0.5 font-mono text-brand-300">
                  {status.data.remoteCommit}
                </code>{' '}
                — <b>{status.data.pending?.length ?? 0}</b> new commit(s) pending.
              </div>
              {status.data.pending?.length > 0 && (
                <details className="mt-2">
                  <summary className="cursor-pointer text-xs text-ink-200">Show what's changing</summary>
                  <ul className="mt-2 space-y-1 font-mono text-[11px] text-ink-100">
                    {status.data.pending.map((line: string, i: number) => (
                      <li key={i} className="rounded bg-ink-900/40 px-2 py-1">{line}</li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
            <button
              className="btn-primary"
              disabled={install.isPending || status.data.updating}
              onClick={() => {
                if (confirm('Pull the latest code, rebuild, restart the API and web containers, and run any new database migrations?\n\nThis will briefly interrupt the app.'))
                  install.mutate();
              }}
            >
              <Download size={14}/>{status.data.updating ? 'Updating…' : 'Install update now'}
            </button>
          </div>
        </div>
      ) : status.data.message ? (
        <div className="card border-amber-500/30 bg-amber-500/5 mb-4 p-5">
          <div className="flex items-center gap-2 text-sm text-amber-300">
            <AlertTriangle size={14}/>{status.data.message}
          </div>
        </div>
      ) : (
        <div className="card border-emerald-500/30 bg-emerald-500/5 mb-4 p-5">
          <div className="flex items-center gap-2 text-sm text-emerald-300">
            <CheckCircle2 size={14}/>You're on the latest version.
          </div>
        </div>
      )}

      {/* Live updater log */}
      {(showLog || status.data.updating) && (
        <div className="card overflow-hidden">
          <header className="flex items-center justify-between border-b border-ink-500/40 px-5 py-3">
            <div className="text-sm font-semibold text-white">
              Updater log {status.data.updating && <span className="ml-2 pill-amber">running</span>}
            </div>
            <button className="btn-ghost" onClick={() => log.refetch()}>
              <RefreshCw size={12}/>Refresh
            </button>
          </header>
          <pre className="max-h-[420px] overflow-auto bg-ink-950 p-4 font-mono text-[11px] leading-5 text-ink-100">
{log.data?.lines || '(no log yet — click Install update to start)'}
          </pre>
        </div>
      )}

      <p className="mt-4 text-[11px] text-ink-200">
        The updater runs as a short-lived helper container using the Docker socket. Your API + web
        containers restart during the install (typically ~60–90 seconds). Migrations run
        automatically at the end.
      </p>
    </>
  );
}
