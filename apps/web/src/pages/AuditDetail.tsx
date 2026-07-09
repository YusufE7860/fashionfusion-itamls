import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { PageHeader } from '@/components/PageHeader';
import { Pill } from '@/components/Pill';
import { CheckCircle2, XCircle, AlertCircle, ScanLine } from 'lucide-react';

export function AuditDetail() {
  const { id } = useParams();
  const qc = useQueryClient();
  const [scanTag, setScanTag] = useState('');

  const audit = useQuery({
    queryKey: ['audit', id],
    queryFn: () => api.get(`/audits/${id}`).then((r) => r.data),
    enabled: !!id,
  });
  const summary = useQuery({
    queryKey: ['audit-summary', id],
    queryFn: () => api.get(`/audits/${id}/summary`).then((r) => r.data),
    enabled: !!id,
  });

  const scan = useMutation({
    mutationFn: (assetTag: string) => api.post(`/audits/${id}/scan`, { assetTag }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['audit', id] });
      qc.invalidateQueries({ queryKey: ['audit-summary', id] });
      setScanTag('');
    },
  });

  const variance = useMutation({
    mutationFn: ({ lineId, variance }: { lineId: string; variance: string }) =>
      api.post(`/audits/lines/${lineId}/variance`, { variance }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['audit', id] });
      qc.invalidateQueries({ queryKey: ['audit-summary', id] });
    },
  });

  const complete = useMutation({
    mutationFn: () => api.post(`/audits/${id}/complete`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['audit', id] }),
  });

  const a = audit.data;
  if (!a) return <div>Loading…</div>;

  return (
    <>
      <PageHeader
        title={`${a.code} - ${a.store?.name}`}
        subtitle={`Scheduled ${new Date(a.scheduledFor).toLocaleDateString()}`}
        actions={
          a.status !== 'COMPLETED' &&
          <button className="btn-primary" onClick={() => complete.mutate()}>Complete audit</button>
        }
      />

      <div className="grid grid-cols-4 gap-3">
        {[
          { label: 'Expected', value: summary.data?.total, tone: 'bg-brand-700' },
          { label: 'Found',    value: summary.data?.found, tone: 'bg-emerald-600' },
          { label: 'Missing',  value: summary.data?.missing, tone: 'bg-rose-600' },
          { label: 'Unrecorded', value: summary.data?.unrecorded, tone: 'bg-amber-500' },
        ].map((t) => (
          <div key={t.label} className="card p-3">
            <div className={`mb-2 h-2 w-10 rounded-full ${t.tone}`} />
            <div className="text-xs uppercase text-slate-500">{t.label}</div>
            <div className="text-xl font-semibold">{t.value ?? '—'}</div>
          </div>
        ))}
      </div>

      {a.status !== 'COMPLETED' && (
        <div className="card mt-4 p-4">
          <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold"><ScanLine size={16}/>Scan / enter asset tag</h3>
          <div className="flex gap-2">
            <input className="field max-w-xs font-mono" placeholder="FF-POS-G-001"
                   value={scanTag}
                   onChange={(e) => setScanTag(e.target.value.toUpperCase())}
                   onKeyDown={(e) => e.key === 'Enter' && scanTag && scan.mutate(scanTag)} />
            <button className="btn-primary" disabled={!scanTag || scan.isPending} onClick={() => scan.mutate(scanTag)}>
              Confirm
            </button>
          </div>
          <p className="mt-1 text-xs text-slate-500">
            On a mobile, point the camera at the QR; here, type or paste the tag.
          </p>
        </div>
      )}

      <div className="card mt-4 overflow-hidden">
        <header className="border-b px-4 py-2 text-sm font-semibold">Audit lines</header>
        <table className="w-full">
          <thead className="bg-slate-50">
            <tr>
              <th className="th">Asset</th><th className="th">Expected</th>
              <th className="th">Found</th><th className="th">Variance</th>
              <th className="th">Actions</th>
            </tr>
          </thead>
          <tbody>
            {a.lines?.map((l: any) => (
              <tr key={l.id} className="border-t">
                <td className="td">
                  {l.asset
                    ? <><span className="font-mono">{l.asset.assetTag}</span> <span className="text-xs text-slate-500">{l.asset.sku.model}</span></>
                    : <span className="text-slate-500 italic">(unrecorded)</span>}
                </td>
                <td className="td">{l.expected ? <CheckCircle2 size={14} className="text-emerald-600"/> : <XCircle size={14} className="text-slate-300"/>}</td>
                <td className="td">{l.found ? <CheckCircle2 size={14} className="text-emerald-600"/> : <XCircle size={14} className="text-slate-300"/>}</td>
                <td className="td">{l.variance ? <Pill status={l.variance} /> : '—'}</td>
                <td className="td">
                  {a.status !== 'COMPLETED' && !l.variance && (
                    <div className="flex gap-1 text-xs">
                      <button className="btn-ghost" onClick={() => variance.mutate({ lineId: l.id, variance: 'DAMAGED' })}>
                        <AlertCircle size={12}/>Damaged
                      </button>
                      <button className="btn-ghost" onClick={() => variance.mutate({ lineId: l.id, variance: 'MISSING' })}>
                        <XCircle size={12}/>Missing
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {a.lines?.length === 0 && (
              <tr><td className="td" colSpan={5}>This store has no assets assigned yet — nothing to audit.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
