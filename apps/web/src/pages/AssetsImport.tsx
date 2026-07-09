import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { api } from '@/api/client';
import { useAuth } from '@/store/auth';
import { PageHeader } from '@/components/PageHeader';
import { Download, Upload, Check, X } from 'lucide-react';

export function AssetsImport() {
  const navigate = useNavigate();
  const token = useAuth((s) => s.token);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<any>(null);

  const dryRun = useMutation({
    mutationFn: async () => {
      const fd = new FormData(); fd.append('file', file!);
      return api.post('/assets/import/dry-run', fd, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data);
    },
    onSuccess: (d) => setPreview(d),
    onError: (e: any) => alert(e.response?.data?.message ?? 'Validation failed'),
  });
  const commit = useMutation({
    mutationFn: async () => {
      const fd = new FormData(); fd.append('file', file!);
      return api.post('/assets/import/commit', fd, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data);
    },
    onSuccess: (d) => {
      alert(`Committed ${d.committed} asset(s).`);
      navigate('/assets');
    },
    onError: (e: any) => alert(e.response?.data?.message ?? 'Commit failed'),
  });

  function downloadTemplate() {
    fetch(`${api.defaults.baseURL}/assets/import/template.csv`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.blob())
      .then((b) => {
        const a = document.createElement('a');
        a.href = URL.createObjectURL(b); a.download = 'assets-import-template.csv'; a.click();
      });
  }

  return (
    <>
      <PageHeader
        title="Bulk Import Assets"
        subtitle="Upload a CSV to onboard your existing register in one shot"
        actions={<button className="btn-ghost" onClick={downloadTemplate}><Download size={14}/>Template</button>}
      />

      <div className="card mb-4 p-4">
        <h3 className="mb-2 text-sm font-semibold text-white">1. Pick a CSV file</h3>
        <input type="file" accept=".csv,text/csv" className="field"
               onChange={(e) => { setFile(e.target.files?.[0] ?? null); setPreview(null); }} />
        <p className="mt-2 text-xs text-ink-200">
          Columns: <code className="text-brand-300">assetTag, serialNo, skuCode, supplierName, purchaseDate, purchaseCostCents, warrantyExpiry, locationCode, storeCode, condition</code>.
          Use the Template button above to download a sample.
        </p>
        <div className="mt-3 flex gap-2">
          <button className="btn-primary" disabled={!file || dryRun.isPending}
                  onClick={() => dryRun.mutate()}>
            <Upload size={14}/>{dryRun.isPending ? 'Validating…' : 'Validate (dry run)'}
          </button>
        </div>
      </div>

      {preview && (
        <div className="card overflow-hidden">
          <header className="border-b border-ink-500/40 px-5 py-3 text-sm font-semibold text-white">
            Validation report — {preview.summary.ok} ready, {preview.summary.errors} with errors, {preview.summary.total} total
          </header>
          <div className="max-h-[60vh] overflow-auto">
            <table className="w-full">
              <thead>
                <tr><th className="th">Row</th><th className="th">Asset tag</th><th className="th">SKU</th>
                    <th className="th">Status</th><th className="th">Notes</th></tr>
              </thead>
              <tbody>
                {preview.rows.map((r: any) => (
                  <tr key={r.rowNumber} className="border-t border-ink-500/30">
                    <td className="td font-mono text-xs">{r.rowNumber}</td>
                    <td className="td font-mono">{r.raw.assetTag ?? '—'}</td>
                    <td className="td">{r.raw.skuCode ?? '—'}</td>
                    <td className="td">
                      {r.ok
                        ? <span className="pill-green"><Check size={11}/>OK</span>
                        : <span className="pill-red"><X size={11}/>Error</span>}
                    </td>
                    <td className="td text-xs">{r.errors.length > 0 ? r.errors.join('; ') : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {preview.summary.errors === 0 && preview.summary.ok > 0 && (
            <div className="border-t border-ink-500/40 p-4">
              <button className="btn-primary" disabled={commit.isPending} onClick={() => commit.mutate()}>
                <Check size={14}/>{commit.isPending ? 'Committing…' : `Commit ${preview.summary.ok} asset(s)`}
              </button>
            </div>
          )}
        </div>
      )}
    </>
  );
}
