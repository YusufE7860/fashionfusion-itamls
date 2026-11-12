import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { PageHeader } from '@/components/PageHeader';
import { formatZAR } from '@itamls/shared';
import { Plus, X, Save } from 'lucide-react';
import { RandInput, NumInput } from '@/components/RandInput';

export function TonerTypes() {
  const qc = useQueryClient();
  const types = useQuery({ queryKey: ['toner-types'], queryFn: () => api.get('/toner/types').then((r) => r.data) });
  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ code: '', name: '', manufacturer: 'HP', unitCostCents: 0, vatPct: 15, hqStock: 0, reorderLevel: 0 });

  const create = useMutation({
    mutationFn: () => api.post('/toner/types', form).then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['toner-types'] }); setShowNew(false);
      setForm({ code: '', name: '', manufacturer: 'HP', unitCostCents: 0, vatPct: 15, hqStock: 0, reorderLevel: 0 }); },
  });

  return (
    <>
      <PageHeader
        title="Toner Types"
        subtitle="Define the toner cartridges you order"
        actions={<button className="btn-primary" onClick={() => setShowNew(!showNew)}>
          {showNew ? <><X size={14}/>Cancel</> : <><Plus size={14}/>New toner type</>}
        </button>}
      />

      {showNew && (
        <div className="card mb-4 p-4">
          <h3 className="mb-3 text-sm font-semibold text-white">Create toner type</h3>
          <div className="grid grid-cols-4 gap-3">
            <div><label className="label">Code</label>
              <input className="field font-mono" value={form.code} onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })} placeholder="111L" /></div>
            <div className="col-span-2"><label className="label">Name</label>
              <input className="field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} placeholder="HP 111L Original" /></div>
            <div><label className="label">Manufacturer</label>
              <input className="field" value={form.manufacturer} onChange={(e) => setForm({ ...form, manufacturer: e.target.value })} /></div>
            <div><label className="label">Unit cost (ex VAT)</label>
              <RandInput valueCents={form.unitCostCents}
                onChangeCents={(v) => setForm({ ...form, unitCostCents: v ?? 0 })} /></div>
            <div><label className="label">VAT %</label>
              <NumInput value={form.vatPct} onChange={(n) => setForm({ ...form, vatPct: n })} /></div>
            <div><label className="label">HQ stock</label>
              <NumInput value={form.hqStock} onChange={(n) => setForm({ ...form, hqStock: n })} /></div>
            <div><label className="label">Reorder level</label>
              <NumInput value={form.reorderLevel} onChange={(n) => setForm({ ...form, reorderLevel: n })} /></div>
          </div>
          <button className="btn-primary mt-3" disabled={!form.code || !form.name || create.isPending}
            onClick={() => create.mutate()}>{create.isPending ? 'Saving…' : 'Save'}</button>
        </div>
      )}

      <div className="card overflow-hidden">
        <table className="w-full">
          <thead>
            <tr>
              <th className="th">Code</th><th className="th">Name</th><th className="th">Manufacturer</th>
              <th className="th text-right">Cost (ex VAT)</th><th className="th text-right">VAT %</th>
              <th className="th text-right">HQ stock</th><th className="th text-right">Reorder</th><th></th>
            </tr>
          </thead>
          <tbody>
            {types.data?.map((t: any) => <TypeRow key={t.id} type={t} />)}
            {(!types.data || types.data.length === 0) && (
              <tr><td className="td" colSpan={8}>No toner types yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}

function TypeRow({ type }: { type: any }) {
  const qc = useQueryClient();
  const [edit, setEdit] = useState({ unitCostCents: type.unitCostCents, hqStock: type.hqStock, reorderLevel: type.reorderLevel });
  const dirty = edit.unitCostCents !== type.unitCostCents || edit.hqStock !== type.hqStock || edit.reorderLevel !== type.reorderLevel;
  const update = useMutation({
    mutationFn: () => api.patch(`/toner/types/${type.id}`, edit).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['toner-types'] }),
  });
  return (
    <tr className="border-t border-ink-500/30">
      <td className="td font-mono">{type.code}</td>
      <td className="td">{type.name}</td>
      <td className="td">{type.manufacturer}</td>
      <td className="td text-right">
        <RandInput className="w-32" valueCents={edit.unitCostCents}
          onChangeCents={(v) => setEdit({ ...edit, unitCostCents: v ?? 0 })} />
      </td>
      <td className="td text-right font-mono">{type.vatPct}%</td>
      <td className="td text-right">
        <input type="text" inputMode="numeric" className="field w-20 text-right font-mono"
          value={edit.hqStock}
          onChange={(e) => {
            const n = parseInt(e.target.value.replace(/[^\d]/g, ''), 10);
            setEdit({ ...edit, hqStock: Number.isFinite(n) ? n : 0 });
          }} /></td>
      <td className="td text-right">
        <NumInput className="w-20 text-right font-mono" min={0}
          value={edit.reorderLevel}
          onChange={(n) => setEdit({ ...edit, reorderLevel: n })} /></td>
      <td className="td text-right">
        {dirty && <button className="btn-primary" onClick={() => update.mutate()}><Save size={12}/>Save</button>}
      </td>
    </tr>
  );
}
