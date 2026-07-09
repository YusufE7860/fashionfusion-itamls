import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { PageHeader } from '@/components/PageHeader';
import { formatZAR } from '@itamls/shared';
import { Plus, X, KeyRound, Calendar } from 'lucide-react';

export function Software() {
  const qc = useQueryClient();
  const summary = useQuery({ queryKey: ['sw-summary'], queryFn: () => api.get('/software/summary').then((r) => r.data) });
  const titles = useQuery({ queryKey: ['sw-titles'], queryFn: () => api.get('/software/titles').then((r) => r.data) });
  const suppliers = useQuery({ queryKey: ['suppliers'], queryFn: () => api.get('/suppliers').then((r) => r.data) });
  const users = useQuery({ queryKey: ['users'], queryFn: () => api.get('/users').then((r) => r.data) });

  const [showNewTitle, setShowNewTitle] = useState(false);
  const [titleForm, setTitleForm] = useState({ name: '', vendor: '', type: 'PERPETUAL', notes: '' });
  const createTitle = useMutation({
    mutationFn: () => api.post('/software/titles', titleForm).then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sw-titles'] }); setShowNewTitle(false);
                       setTitleForm({ name: '', vendor: '', type: 'PERPETUAL', notes: '' }); },
  });

  const [showNewLicense, setShowNewLicense] = useState<string | null>(null);
  const [licForm, setLicForm] = useState({
    licenseKey: '', seatsTotal: 1, costCents: 0,
    purchaseDate: new Date().toISOString().slice(0,10),
    expiryDate: '', supplierId: '', notes: '',
  });
  const createLicense = useMutation({
    mutationFn: () => api.post('/software/licenses', { titleId: showNewLicense, ...licForm,
      supplierId: licForm.supplierId || undefined,
      expiryDate: licForm.expiryDate || undefined }).then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['sw-titles'] }); setShowNewLicense(null);
      setLicForm({ licenseKey:'', seatsTotal:1, costCents:0, purchaseDate: new Date().toISOString().slice(0,10), expiryDate:'', supplierId:'', notes:'' }); },
  });

  const assign = useMutation({
    mutationFn: ({ licId, userId }: any) => api.post(`/software/licenses/${licId}/assign`, { userId }).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sw-titles'] }),
    onError: (e: any) => alert(e.response?.data?.message ?? 'Assign failed'),
  });
  const revoke = useMutation({
    mutationFn: (assignmentId: string) => api.post(`/software/assignments/${assignmentId}/revoke`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['sw-titles'] }),
  });

  return (
    <>
      <PageHeader
        title="Software & Licenses"
        subtitle="Track software titles, license seats, expiries and assignments"
        actions={<button className="btn-primary" onClick={() => setShowNewTitle(!showNewTitle)}>
          {showNewTitle ? <><X size={14}/>Cancel</> : <><Plus size={14}/>New title</>}
        </button>}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-4">
        <Tile label="Titles"           value={summary.data?.titles ?? '—'} />
        <Tile label="Licenses"         value={summary.data?.licenses ?? '—'} />
        <Tile label="Seats used"       value={summary.data ? `${summary.data.seatsUsed}/${summary.data.seatsTotal}` : '—'} />
        <Tile label="Annual spend"     value={summary.data ? formatZAR(summary.data.annualSpendCents) : '—'} />
      </div>
      {summary.data && (summary.data.expiringSoon > 0 || summary.data.expired > 0) && (
        <div className="mb-4 rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-200">
          <Calendar size={14} className="mr-1 inline"/>
          <b>{summary.data.expired}</b> licenses already expired, <b>{summary.data.expiringSoon}</b> expiring in the next 60 days.
        </div>
      )}

      {showNewTitle && (
        <div className="card mb-4 p-4">
          <h3 className="mb-2 text-sm font-semibold text-white">Create software title</h3>
          <div className="grid grid-cols-3 gap-3">
            <div><label className="label">Name</label>
              <input className="field" value={titleForm.name} onChange={(e) => setTitleForm({ ...titleForm, name: e.target.value })} placeholder="Microsoft 365 Business Standard" /></div>
            <div><label className="label">Vendor</label>
              <input className="field" value={titleForm.vendor} onChange={(e) => setTitleForm({ ...titleForm, vendor: e.target.value })} placeholder="Microsoft" /></div>
            <div><label className="label">Type</label>
              <select className="field" value={titleForm.type} onChange={(e) => setTitleForm({ ...titleForm, type: e.target.value })}>
                <option>PERPETUAL</option><option>SUBSCRIPTION</option><option>SAAS</option><option>OEM</option>
              </select></div>
          </div>
          <button className="btn-primary mt-3" disabled={!titleForm.name || !titleForm.vendor || createTitle.isPending}
                  onClick={() => createTitle.mutate()}>Save</button>
        </div>
      )}

      <div className="space-y-4">
        {titles.data?.map((t: any) => (
          <div key={t.id} className="card overflow-hidden">
            <header className="flex items-center justify-between border-b border-ink-500/40 px-5 py-3">
              <div>
                <div className="flex items-center gap-2">
                  <span className="pill-brand">{t.type}</span>
                  <span className="font-semibold text-white">{t.name}</span>
                  <span className="text-xs text-ink-200">— {t.vendor}</span>
                </div>
              </div>
              <button className="btn-ghost" onClick={() => setShowNewLicense(t.id)}><Plus size={12}/>Add license</button>
            </header>

            {showNewLicense === t.id && (
              <div className="border-b border-ink-500/40 bg-ink-700/20 p-4">
                <div className="grid grid-cols-4 gap-3">
                  <div className="col-span-2"><label className="label">License key (last 4 stored as mask)</label>
                    <input className="field font-mono" value={licForm.licenseKey} onChange={(e) => setLicForm({ ...licForm, licenseKey: e.target.value })} /></div>
                  <div><label className="label">Seats</label>
                    <input type="number" min={1} className="field" value={licForm.seatsTotal} onChange={(e) => setLicForm({ ...licForm, seatsTotal: +e.target.value })} /></div>
                  <div><label className="label">Cost (cents)</label>
                    <input type="number" min={0} className="field" value={licForm.costCents} onChange={(e) => setLicForm({ ...licForm, costCents: +e.target.value })} /></div>
                  <div><label className="label">Purchase date</label>
                    <input type="date" className="field" value={licForm.purchaseDate} onChange={(e) => setLicForm({ ...licForm, purchaseDate: e.target.value })} /></div>
                  <div><label className="label">Expiry</label>
                    <input type="date" className="field" value={licForm.expiryDate} onChange={(e) => setLicForm({ ...licForm, expiryDate: e.target.value })} /></div>
                  <div className="col-span-2"><label className="label">Supplier</label>
                    <select className="field" value={licForm.supplierId} onChange={(e) => setLicForm({ ...licForm, supplierId: e.target.value })}>
                      <option value="">—</option>
                      {suppliers.data?.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
                    </select></div>
                </div>
                <div className="mt-3 flex gap-2">
                  <button className="btn-primary" disabled={createLicense.isPending} onClick={() => createLicense.mutate()}>Save license</button>
                  <button className="btn-ghost" onClick={() => setShowNewLicense(null)}>Cancel</button>
                </div>
              </div>
            )}

            <table className="w-full">
              <thead><tr>
                <th className="th">Key</th><th className="th text-right">Seats</th>
                <th className="th">Expiry</th><th className="th text-right">Cost</th>
                <th className="th">Assigned to</th><th className="th"></th>
              </tr></thead>
              <tbody>
                {t.licenses?.map((l: any) => {
                  const expired = l.expiryDate && new Date(l.expiryDate) < new Date();
                  return (
                    <tr key={l.id} className="border-t border-ink-500/30">
                      <td className="td font-mono text-xs"><KeyRound size={11} className="mr-1 inline"/>{l.licenseKeyMask ?? '—'}</td>
                      <td className="td text-right font-mono">{l.assignments.length}/{l.seatsTotal}</td>
                      <td className={`td ${expired ? 'text-rose-300' : ''}`}>{l.expiryDate ? new Date(l.expiryDate).toLocaleDateString() : 'No expiry'}</td>
                      <td className="td text-right font-mono">{formatZAR(l.costCents)}</td>
                      <td className="td">
                        <div className="flex flex-wrap gap-1">
                          {l.assignments.map((a: any) => {
                            const u = users.data?.find((u: any) => u.id === a.userId);
                            return (
                              <span key={a.id} className="inline-flex items-center gap-1 rounded-md bg-ink-700/60 px-2 py-0.5 text-[11px]">
                                {u?.fullName ?? a.userId ?? a.assetId ?? '—'}
                                <button onClick={() => revoke.mutate(a.id)} className="ml-1 text-rose-300 hover:text-rose-200"><X size={10}/></button>
                              </span>
                            );
                          })}
                        </div>
                      </td>
                      <td className="td text-right">
                        {l.assignments.length < l.seatsTotal && (
                          <select className="field text-xs" defaultValue=""
                                  onChange={(e) => { if (e.target.value) { assign.mutate({ licId: l.id, userId: e.target.value }); e.target.value = ''; } }}>
                            <option value="">Assign user…</option>
                            {users.data?.map((u: any) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
                          </select>
                        )}
                      </td>
                    </tr>
                  );
                })}
                {(t.licenses?.length ?? 0) === 0 && (
                  <tr><td className="td" colSpan={6}>No licenses for this title yet.</td></tr>
                )}
              </tbody>
            </table>
          </div>
        ))}
      </div>
    </>
  );
}

function Tile({ label, value }: { label: string; value: any }) {
  return (
    <div className="card p-3">
      <div className="text-[10px] font-bold uppercase tracking-widest text-ink-200">{label}</div>
      <div className="mt-1 text-2xl font-bold text-white">{value}</div>
    </div>
  );
}
