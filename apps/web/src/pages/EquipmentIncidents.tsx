import { useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { PageHeader } from '@/components/PageHeader';
import { formatZAR } from '@itamls/shared';
import { useAuth } from '@/store/auth';
import { RandInput } from '@/components/RandInput';
import {
  AlertTriangle, CheckCircle2, FileText, Plus, Search, Trash2, X, Upload, Download,
  Pencil, DollarSign,
} from 'lucide-react';
import clsx from 'clsx';

// --------------------------------------------------------------------------
// Equipment incident register
//
// What this module is for:
//   - Logging a piece of equipment a staff member broke / lost / damaged.
//   - Tracking the responsible person + replacement cost.
//   - Recording whether an Acknowledgement of Debt (AOD) has been issued and
//     uploading the signed scan so it's one click to find later.
//   - Driving a resolution status (OPEN → AOD issued → deducting → paid /
//     written off / recovered / disputed) so ops can follow through.
// --------------------------------------------------------------------------

type Incident = {
  id: string; code: string;
  storeId?: string | null; store?: { code: string; name: string } | null;
  assetId?: string | null; asset?: { assetTag: string; serialNo?: string | null } | null;
  itemDescription: string;
  incidentType: 'BROKEN' | 'LOST' | 'STOLEN' | 'DAMAGED' | 'OTHER';
  incidentDate: string;
  responsibleName: string;
  responsibleEmpNo?: string | null;
  description?: string | null;
  replacementCostCents: number;
  aodIssued: boolean;
  aodNumber?: string | null;
  aodDate?: string | null;
  aodFileKey?: string | null;
  aodFileUrl?: string | null;
  status: 'OPEN' | 'AOD_ISSUED' | 'DEDUCTING' | 'PAID' | 'WRITTEN_OFF' | 'RECOVERED' | 'DISPUTED';
  notes?: string | null;
  reportedBy?: { fullName: string } | null;
  createdAt: string;
};

const STATUS_TONE: Record<Incident['status'], string> = {
  OPEN:        'bg-amber-100 text-amber-800 ring-amber-300',
  AOD_ISSUED:  'bg-sky-100 text-sky-800 ring-sky-300',
  DEDUCTING:   'bg-violet-100 text-violet-800 ring-violet-300',
  PAID:        'bg-emerald-100 text-emerald-800 ring-emerald-300',
  RECOVERED:   'bg-emerald-100 text-emerald-800 ring-emerald-300',
  WRITTEN_OFF: 'bg-slate-200 text-slate-700 ring-slate-400',
  DISPUTED:    'bg-rose-100 text-rose-800 ring-rose-300',
};

export function EquipmentIncidents() {
  const qc = useQueryClient();
  const hasPerm = useAuth((s) => s.hasPermission);
  const canWrite = hasPerm('assets:write');

  const [status, setStatus]   = useState<'ALL' | Incident['status']>('ALL');
  const [storeId, setStoreId] = useState('ALL');
  const [search, setSearch]   = useState('');
  const [editing, setEditing] = useState<Incident | null>(null);
  const [showNew, setShowNew] = useState(false);

  const stores = useQuery({
    queryKey: ['stores'],
    queryFn: () => api.get<any[]>('/stores').then((r) => r.data).catch(() => []),
  });

  const list = useQuery({
    queryKey: ['incidents', status, storeId, search],
    queryFn: () => api.get<Incident[]>('/equipment-incidents', {
      params: {
        status:  status  === 'ALL' ? undefined : status,
        storeId: storeId === 'ALL' ? undefined : storeId,
        search:  search || undefined,
      },
    }).then((r) => r.data),
  });

  const summary = useQuery({
    queryKey: ['incident-summary'],
    queryFn: () => api.get('/equipment-incidents/summary').then((r) => r.data),
  });

  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/equipment-incidents/${id}`).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['incidents'] });
      qc.invalidateQueries({ queryKey: ['incident-summary'] });
    },
  });

  return (
    <>
      <PageHeader
        title="Equipment incidents"
        subtitle="Damage / loss / theft log — staff accountability + AOD tracking"
        actions={canWrite && (
          <button className="btn-primary" onClick={() => setShowNew(true)}>
            <Plus size={13}/>Log incident
          </button>
        )}
      />

      {/* Summary cards */}
      <div className="mb-4 grid grid-cols-2 gap-3 sm:grid-cols-4">
        <SummaryCard tone="amber"   icon={<AlertTriangle size={14}/>}
          label="Open"        value={summary.data?.openCount ?? 0}/>
        <SummaryCard tone="sky"     icon={<FileText size={14}/>}
          label="AOD issued"  value={summary.data?.aodIssuedCount ?? 0}/>
        <SummaryCard tone="emerald" icon={<CheckCircle2 size={14}/>}
          label="Recovered"   value={summary.data?.recoveredCount ?? 0}/>
        <SummaryCard tone="slate"   icon={<DollarSign size={14}/>}
          label="Outstanding" value={formatZAR(summary.data?.outstandingCents ?? 0)} isMoney/>
      </div>

      {/* Filter strip */}
      <section className="card mb-3 flex flex-wrap items-center gap-2 p-2">
        <div className="relative flex-1 min-w-[220px]">
          <Search size={12} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-300"/>
          <input className="field pl-7 text-xs" placeholder="Code / item / staff name / AOD no…"
            value={search} onChange={(e) => setSearch(e.target.value)}/>
        </div>
        <select className="field !py-1 text-xs" value={status} onChange={(e) => setStatus(e.target.value as any)}>
          <option value="ALL">All statuses</option>
          <option value="OPEN">Open</option>
          <option value="AOD_ISSUED">AOD issued</option>
          <option value="DEDUCTING">Deducting from payroll</option>
          <option value="PAID">Paid</option>
          <option value="RECOVERED">Recovered</option>
          <option value="WRITTEN_OFF">Written off</option>
          <option value="DISPUTED">Disputed</option>
        </select>
        <select className="field !py-1 text-xs" value={storeId} onChange={(e) => setStoreId(e.target.value)}>
          <option value="ALL">All stores</option>
          {stores.data?.map((s) => (
            <option key={s.id} value={s.id}>{s.code} — {s.name}</option>
          ))}
        </select>
      </section>

      {/* Table */}
      <section className="card p-2 md:p-4">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[900px] text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="th text-left">Code</th>
                <th className="th text-left">Date</th>
                <th className="th text-left">Store</th>
                <th className="th text-left">Item</th>
                <th className="th text-left">Type</th>
                <th className="th text-left">Responsible</th>
                <th className="th text-right">Cost</th>
                <th className="th text-left">AOD</th>
                <th className="th text-left">Status</th>
                <th className="th text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {list.data?.length === 0 && (
                <tr><td colSpan={10} className="py-8 text-center text-xs text-ink-300">
                  No incidents logged yet.
                </td></tr>
              )}
              {list.data?.map((r) => (
                <tr key={r.id} className="border-t">
                  <td className="td font-mono">{r.code}</td>
                  <td className="td">{new Date(r.incidentDate).toLocaleDateString()}</td>
                  <td className="td">{r.store ? `${r.store.code} — ${r.store.name}` : '—'}</td>
                  <td className="td">
                    <div className="font-medium">{r.itemDescription}</div>
                    {r.asset && <div className="text-[10px] text-ink-300 font-mono">{r.asset.assetTag}</div>}
                  </td>
                  <td className="td text-xs">{r.incidentType}</td>
                  <td className="td">
                    <div>{r.responsibleName}</div>
                    {r.responsibleEmpNo && <div className="text-[10px] text-ink-300">{r.responsibleEmpNo}</div>}
                  </td>
                  <td className="td text-right font-mono">{formatZAR(r.replacementCostCents)}</td>
                  <td className="td text-xs">
                    {r.aodIssued ? (
                      <div className="flex items-center gap-1">
                        <CheckCircle2 size={12} className="text-emerald-600"/>
                        <span>{r.aodNumber ?? 'Yes'}</span>
                      </div>
                    ) : <span className="text-ink-300">—</span>}
                  </td>
                  <td className="td">
                    <span className={clsx(
                      'rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1',
                      STATUS_TONE[r.status],
                    )}>{r.status}</span>
                  </td>
                  <td className="td text-right">
                    <div className="flex justify-end gap-1">
                      <button className="btn-ghost" onClick={() => setEditing(r)}>
                        <Pencil size={12}/>
                      </button>
                      {canWrite && (
                        <button className="btn-ghost text-rose-600"
                          onClick={() => { if (confirm(`Delete incident ${r.code}?`)) remove.mutate(r.id); }}>
                          <Trash2 size={12}/>
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      {showNew   && <IncidentForm onClose={() => setShowNew(false)}/>}
      {editing   && <IncidentForm onClose={() => setEditing(null)} initial={editing}/>}
    </>
  );
}

// =========================================================================
//  Create / edit modal
// =========================================================================
function IncidentForm({ onClose, initial }: { onClose: () => void; initial?: Incident }) {
  const qc = useQueryClient();
  const stores = useQuery({
    queryKey: ['stores'],
    queryFn: () => api.get<any[]>('/stores').then((r) => r.data).catch(() => []),
  });
  const fileRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState({
    storeId:              initial?.storeId ?? '',
    assetId:              initial?.assetId ?? '',
    itemDescription:      initial?.itemDescription ?? '',
    incidentType:         initial?.incidentType ?? 'BROKEN',
    incidentDate:         initial?.incidentDate?.slice(0, 10) ?? new Date().toISOString().slice(0, 10),
    responsibleName:      initial?.responsibleName ?? '',
    responsibleEmpNo:     initial?.responsibleEmpNo ?? '',
    description:          initial?.description ?? '',
    replacementCostCents: initial?.replacementCostCents ?? 0,
    aodIssued:            initial?.aodIssued ?? false,
    aodNumber:            initial?.aodNumber ?? '',
    aodDate:              initial?.aodDate?.slice(0, 10) ?? '',
    status:               initial?.status ?? 'OPEN',
    notes:                initial?.notes ?? '',
  });

  const save = useMutation({
    mutationFn: () => {
      const payload: any = { ...form };
      // Server treats blanks as unset where expected — strip empties.
      for (const k of Object.keys(payload)) if (payload[k] === '') delete payload[k];
      return initial?.id
        ? api.patch(`/equipment-incidents/${initial.id}`, payload).then((r) => r.data)
        : api.post('/equipment-incidents', payload).then((r) => r.data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['incidents'] });
      qc.invalidateQueries({ queryKey: ['incident-summary'] });
      onClose();
    },
    onError: (e: any) => alert(e?.response?.data?.message ?? 'Save failed'),
  });

  const uploadAod = useMutation({
    mutationFn: async (file: File) => {
      if (!initial?.id) {
        alert('Save the incident first, then attach the AOD.');
        throw new Error('no id');
      }
      const fd = new FormData();
      fd.append('file', file);
      return api.post(`/equipment-incidents/${initial.id}/aod`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      }).then((r) => r.data);
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['incidents'] }),
  });

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" onClick={onClose}>
      <div className="w-full max-w-3xl rounded-xl bg-white p-5 shadow-2xl max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}>
        <div className="mb-3 flex items-start justify-between">
          <div>
            <h3 className="text-base font-semibold">
              {initial ? `Edit ${initial.code}` : 'Log new incident'}
            </h3>
            <p className="text-xs text-ink-300">
              Record the equipment that was damaged or lost, who was responsible, the cost to replace,
              and any AOD that's been issued.
            </p>
          </div>
          <button className="btn-ghost" onClick={onClose}><X size={14}/></button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <div><label className="label">Store</label>
            <select className="field" value={form.storeId} onChange={(e) => setForm({ ...form, storeId: e.target.value })}>
              <option value="">— no store —</option>
              {stores.data?.map((s) => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
            </select></div>
          <div><label className="label">Incident date</label>
            <input type="date" className="field" value={form.incidentDate}
              onChange={(e) => setForm({ ...form, incidentDate: e.target.value })}/></div>

          <div className="col-span-2"><label className="label">Item description</label>
            <input className="field" value={form.itemDescription}
              placeholder="e.g. Zebra GK420t printer at front till"
              onChange={(e) => setForm({ ...form, itemDescription: e.target.value })}/></div>

          <div><label className="label">Type</label>
            <select className="field" value={form.incidentType}
              onChange={(e) => setForm({ ...form, incidentType: e.target.value as any })}>
              <option value="BROKEN">Broken</option>
              <option value="DAMAGED">Damaged</option>
              <option value="LOST">Lost</option>
              <option value="STOLEN">Stolen</option>
              <option value="OTHER">Other</option>
            </select></div>
          <div><label className="label">Replacement cost</label>
            <RandInput valueCents={form.replacementCostCents}
              onChangeCents={(v) => setForm({ ...form, replacementCostCents: v ?? 0 })}/></div>

          <div><label className="label">Responsible staff name</label>
            <input className="field" value={form.responsibleName}
              onChange={(e) => setForm({ ...form, responsibleName: e.target.value })}/></div>
          <div><label className="label">Employee number <span className="text-ink-400">(optional)</span></label>
            <input className="field" value={form.responsibleEmpNo}
              onChange={(e) => setForm({ ...form, responsibleEmpNo: e.target.value })}/></div>

          <div className="col-span-2"><label className="label">What happened</label>
            <textarea className="field" rows={3} value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}/></div>

          <div className="col-span-2 rounded border border-amber-200 bg-amber-50 p-3">
            <label className="flex items-center gap-2 text-sm font-semibold text-amber-900">
              <input type="checkbox" checked={form.aodIssued}
                onChange={(e) => setForm({ ...form, aodIssued: e.target.checked })}/>
              Acknowledgement of Debt (AOD) issued
            </label>
            {form.aodIssued && (
              <div className="mt-2 grid grid-cols-2 gap-2">
                <div><label className="label">AOD number</label>
                  <input className="field" value={form.aodNumber}
                    onChange={(e) => setForm({ ...form, aodNumber: e.target.value })}/></div>
                <div><label className="label">AOD date</label>
                  <input type="date" className="field" value={form.aodDate}
                    onChange={(e) => setForm({ ...form, aodDate: e.target.value })}/></div>
                <div className="col-span-2">
                  <label className="label">Signed AOD scan</label>
                  <div className="flex items-center gap-2">
                    <input ref={fileRef} type="file" accept="image/*,application/pdf"
                      className="field" onChange={(e) => {
                        const f = e.target.files?.[0];
                        if (f) uploadAod.mutate(f);
                      }}/>
                    {initial?.aodFileUrl && (
                      <a href={initial.aodFileUrl} target="_blank" rel="noreferrer" className="btn-ghost">
                        <Download size={12}/>Current
                      </a>
                    )}
                  </div>
                  {uploadAod.isPending && <div className="mt-1 text-xs text-ink-300">Uploading…</div>}
                  {!initial?.id && (
                    <p className="mt-1 text-[11px] text-ink-300">
                      Save the incident first — the upload becomes available after that.
                    </p>
                  )}
                </div>
              </div>
            )}
          </div>

          <div><label className="label">Resolution status</label>
            <select className="field" value={form.status}
              onChange={(e) => setForm({ ...form, status: e.target.value as any })}>
              <option value="OPEN">Open</option>
              <option value="AOD_ISSUED">AOD issued</option>
              <option value="DEDUCTING">Deducting from payroll</option>
              <option value="PAID">Paid</option>
              <option value="RECOVERED">Recovered (equipment returned)</option>
              <option value="WRITTEN_OFF">Written off</option>
              <option value="DISPUTED">Disputed</option>
            </select></div>
          <div className="col-span-2"><label className="label">Notes</label>
            <textarea className="field" rows={2} value={form.notes}
              onChange={(e) => setForm({ ...form, notes: e.target.value })}/></div>
        </div>

        <div className="mt-4 flex justify-end gap-2 border-t border-ink-500/10 pt-3">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={!form.itemDescription || !form.responsibleName || save.isPending}
            onClick={() => save.mutate()}>
            {save.isPending ? 'Saving…' : (initial ? 'Save changes' : 'Log incident')}
          </button>
        </div>
      </div>
    </div>
  );
}

// =========================================================================
//  Summary card
// =========================================================================
function SummaryCard({ tone, icon, label, value, isMoney }: {
  tone: 'amber' | 'sky' | 'emerald' | 'slate'; icon: any; label: string; value: any; isMoney?: boolean;
}) {
  const toneMap: Record<string, string> = {
    amber:   'border-amber-200 bg-amber-50 text-amber-800',
    sky:     'border-sky-200 bg-sky-50 text-sky-800',
    emerald: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    slate:   'border-slate-200 bg-slate-50 text-slate-800',
  };
  return (
    <div className={clsx('rounded-lg border p-3', toneMap[tone])}>
      <div className="flex items-center gap-1 text-[11px] font-semibold uppercase tracking-wider">
        {icon}{label}
      </div>
      <div className="mt-1 text-xl font-bold">{isMoney ? value : String(value ?? 0)}</div>
    </div>
  );
}
