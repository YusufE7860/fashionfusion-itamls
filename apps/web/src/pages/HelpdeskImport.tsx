import { useRef, useState } from 'react';
import { api } from '@/api/client';
import { PageHeader } from '@/components/PageHeader';
import { useAuth } from '@/store/auth';
import { Upload, CheckCircle2, AlertTriangle, FileSpreadsheet } from 'lucide-react';

/**
 * In-app importer for historical helpdesk tickets. Drop in a ManageEngine
 * .xlsx export and the server runs the same logic the one-shot script does:
 * matches store slugs, matches technician names, imports under "LEG-xxx"
 * codes, idempotent.
 */
export function HelpdeskImport() {
  const hasPerm = useAuth((s) => s.hasPermission);
  const canImport = hasPerm('tickets:manage:categories');
  const inputRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [state, setState] = useState<'idle' | 'uploading' | 'done' | 'error'>('idle');
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState<string>('');

  function onPick(e: React.ChangeEvent<HTMLInputElement>) {
    const f = e.target.files?.[0] ?? null;
    setFile(f); setState('idle'); setResult(null); setError('');
  }

  async function upload() {
    if (!file) return;
    setState('uploading'); setError(''); setResult(null);
    try {
      const fd = new FormData();
      fd.append('file', file);
      const r = await api.post('/helpdesk/imports/manageengine', fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
        timeout: 10 * 60 * 1000,  // 5k rows can take a minute to import
      });
      setResult(r.data);
      setState('done');
    } catch (e: any) {
      setError(e?.response?.data?.message ?? e?.message ?? 'Upload failed');
      setState('error');
    }
  }

  return (
    <>
      <PageHeader
        title="Helpdesk — import historical tickets"
        subtitle="Upload a ManageEngine .xlsx export to import legacy tickets. Idempotent — safe to re-run with the same file."
      />

      {!canImport && (
        <div className="card mb-4 p-4 text-sm text-ink-300">
          You need the <code>tickets:manage:categories</code> permission to import tickets.
        </div>
      )}

      {canImport && (
        <>
          <section className="card mb-4 p-4">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700">
              <FileSpreadsheet size={14}/>Step 1 — Pick the .xlsx file
            </h3>
            <p className="mb-3 text-xs text-ink-300">
              Expected shape: <b>ManageEngine Request Framework</b> export with columns
              Request ID / Subject / Description / Requester / Technician / Created Time / Request Status.
              Up to 50 MB.
            </p>

            <div className="flex flex-wrap items-center gap-3">
              <button
                className="btn-ghost"
                onClick={() => inputRef.current?.click()}>
                <Upload size={13}/>Choose file…
              </button>
              <input ref={inputRef} type="file" accept=".xlsx"
                className="hidden" onChange={onPick}/>
              {file && (
                <div className="text-xs text-ink-100">
                  <b>{file.name}</b> · {Math.round(file.size / 1024)} KB
                </div>
              )}
            </div>

            {file && (
              <button className="btn-primary mt-4"
                disabled={state === 'uploading'}
                onClick={upload}>
                {state === 'uploading' ? 'Importing… this may take a minute' : 'Upload and import'}
              </button>
            )}
          </section>

          {state === 'error' && (
            <section className="card mb-4 border-rose-300 bg-rose-50 p-4 text-sm text-rose-900">
              <div className="flex items-start gap-2">
                <AlertTriangle size={14} className="mt-0.5 shrink-0"/>
                <div>
                  <div className="font-semibold">Import failed</div>
                  <div className="mt-1 text-xs">{error}</div>
                </div>
              </div>
            </section>
          )}

          {state === 'done' && result && (
            <section className="card mb-4 p-4">
              <div className="mb-3 flex items-center gap-2 text-sm font-semibold text-emerald-700">
                <CheckCircle2 size={14}/>Import complete
              </div>

              <dl className="grid grid-cols-2 gap-x-6 gap-y-2 text-sm md:grid-cols-4">
                <div><dt className="text-ink-300 text-xs">Total rows</dt><dd className="font-mono text-lg">{result.total}</dd></div>
                <div><dt className="text-ink-300 text-xs">Created</dt><dd className="font-mono text-lg text-emerald-700">{result.created}</dd></div>
                <div><dt className="text-ink-300 text-xs">Skipped (already present)</dt><dd className="font-mono text-lg text-ink-300">{result.skipped}</dd></div>
                <div><dt className="text-ink-300 text-xs">Orphan store / tech</dt><dd className="font-mono text-lg text-amber-600">{result.orphanStore} / {result.orphanTech}</dd></div>
              </dl>

              {result.unmatchedStores?.length > 0 && (
                <>
                  <h4 className="mt-4 mb-2 text-xs font-semibold uppercase tracking-wider text-ink-300">
                    Unmatched store slugs — fix store codes to re-run
                  </h4>
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="th text-left">Slug from file</th>
                        <th className="th text-right">Count</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.unmatchedStores.map((s: any) => (
                        <tr key={s.slug} className="border-t">
                          <td className="py-1.5 pl-3 font-mono">{s.slug}</td>
                          <td className="py-1.5 pr-3 text-right font-mono">{s.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}

              {result.unmatchedTechnicians?.length > 0 && (
                <>
                  <h4 className="mt-4 mb-2 text-xs font-semibold uppercase tracking-wider text-ink-300">
                    Unmatched technician names — create/rename users to re-run
                  </h4>
                  <table className="w-full text-xs">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="th text-left">Name from file</th>
                        <th className="th text-right">Count</th>
                      </tr>
                    </thead>
                    <tbody>
                      {result.unmatchedTechnicians.map((t: any) => (
                        <tr key={t.name} className="border-t">
                          <td className="py-1.5 pl-3">{t.name}</td>
                          <td className="py-1.5 pr-3 text-right font-mono">{t.count}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </>
              )}

              <p className="mt-4 text-[11px] text-ink-300">
                Imported tickets live under the <b>LEGACY-ME</b> category (hidden from live routing). You can re-upload
                the same file at any time — rows already imported are skipped automatically.
              </p>
            </section>
          )}
        </>
      )}
    </>
  );
}
