import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { useAuth } from '@/store/auth';
import { PageHeader } from '@/components/PageHeader';
import { FileSpreadsheet, FileText } from 'lucide-react';

export function Reports() {
  const token = useAuth((s) => s.token);
  const reports = useQuery({ queryKey: ['reports'], queryFn: () => api.get('/reports').then((r) => r.data) });
  const [active, setActive] = useState<string>('assets-by-category');
  const preview = useQuery({
    queryKey: ['report', active],
    queryFn: () => api.get(`/reports/${active}`).then((r) => r.data),
    enabled: !!active,
  });

  const base = api.defaults.baseURL;

  function download(name: string, fmt: 'pdf' | 'xlsx') {
    // axios won't help here for streamed responses with auth header; use fetch
    fetch(`${base}/reports/${name}?format=${fmt}`, { headers: { Authorization: `Bearer ${token}` } })
      .then(async (r) => {
        if (!r.ok) throw new Error(`HTTP ${r.status}`);
        const blob = await r.blob();
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url; a.download = `${name}.${fmt}`; a.click();
        URL.revokeObjectURL(url);
      });
  }

  return (
    <>
      <PageHeader title="Reports" subtitle="Export to PDF or Excel" />
      <div className="grid grid-cols-[260px_1fr] gap-4">
        <aside className="card p-2">
          {reports.data?.map((r: any) => (
            <button key={r.name}
              onClick={() => setActive(r.name)}
              className={`flex w-full items-center justify-between rounded-md px-3 py-2 text-left text-sm ${active === r.name ? 'bg-brand-700 text-white' : 'hover:bg-slate-100'}`}>
              {r.title}
            </button>
          ))}
        </aside>

        <section className="card overflow-hidden">
          <header className="flex items-center justify-between border-b px-4 py-2">
            <div className="text-sm font-semibold">{preview.data?.title ?? '…'}</div>
            <div className="flex gap-2">
              <button className="btn-ghost" onClick={() => download(active, 'pdf')}><FileText size={14}/>PDF</button>
              <button className="btn-ghost" onClick={() => download(active, 'xlsx')}><FileSpreadsheet size={14}/>Excel</button>
            </div>
          </header>
          <div className="max-h-[60vh] overflow-auto">
            <table className="w-full">
              <thead className="bg-slate-50">
                <tr>
                  {preview.data?.columns?.map((c: string) => <th key={c} className="th">{c}</th>)}
                </tr>
              </thead>
              <tbody>
                {preview.data?.rows?.map((row: any[], i: number) => (
                  <tr key={i} className="border-t">
                    {row.map((cell, j) => <td key={j} className="td">{String(cell ?? '')}</td>)}
                  </tr>
                ))}
                {preview.data?.rows?.length === 0 &&
                  <tr><td className="td" colSpan={preview.data?.columns?.length}>No rows.</td></tr>}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </>
  );
}
