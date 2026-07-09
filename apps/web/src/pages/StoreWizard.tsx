import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { PageHeader } from '@/components/PageHeader';
import { formatZAR } from '@itamls/shared';

export function StoreWizard() {
  const templates = useQuery({ queryKey: ['templates'], queryFn: () => api.get('/store-templates').then((r) => r.data) });
  const [form, setForm] = useState({
    name: '', region: 'KZN', templateId: '', posPoints: 4, offices: 1, printers: 4, screens: 4,
    contingencyPct: 10,
  });
  const [result, setResult] = useState<any>(null);
  const [loading, setLoading] = useState(false);

  async function run() {
    setLoading(true);
    try {
      const { data } = await api.post('/stores/wizard', form);
      setResult(data);
    } finally {
      setLoading(false);
    }
  }

  return (
    <>
      <PageHeader title="New Store Wizard" subtitle="Auto-generate the equipment list and costed proposal" />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <section className="card p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Inputs</h2>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div><label className="label">Store name</label><input className="field" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div><label className="label">Region</label><input className="field" value={form.region} onChange={(e) => setForm({ ...form, region: e.target.value })} /></div>
            <div className="col-span-2"><label className="label">Template</label>
              <select className="field" value={form.templateId} onChange={(e) => setForm({ ...form, templateId: e.target.value })}>
                <option value="">Pick…</option>
                {templates.data?.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </div>
            <div><label className="label">POS points</label><input type="number" className="field" value={form.posPoints} onChange={(e) => setForm({ ...form, posPoints: +e.target.value })} /></div>
            <div><label className="label">Offices</label><input type="number" className="field" value={form.offices} onChange={(e) => setForm({ ...form, offices: +e.target.value })} /></div>
            <div><label className="label">Printers</label><input type="number" className="field" value={form.printers} onChange={(e) => setForm({ ...form, printers: +e.target.value })} /></div>
            <div><label className="label">Screens</label><input type="number" className="field" value={form.screens} onChange={(e) => setForm({ ...form, screens: +e.target.value })} /></div>
            <div><label className="label">Contingency %</label><input type="number" className="field" value={form.contingencyPct} onChange={(e) => setForm({ ...form, contingencyPct: +e.target.value })} /></div>
          </div>
          <button className="btn-primary mt-4" disabled={!form.templateId || loading} onClick={run}>
            {loading ? 'Generating…' : 'Generate proposal'}
          </button>
        </section>

        <section className="card p-4">
          <h2 className="mb-3 text-sm font-semibold text-slate-700">Proposal</h2>
          {!result && <p className="text-sm text-slate-500">Fill in inputs and generate.</p>}
          {result && (
            <>
              <table className="w-full text-sm">
                <thead className="bg-slate-50">
                  <tr><th className="th">Item</th><th className="th text-right">Qty</th><th className="th text-right">Unit</th><th className="th text-right">Line</th></tr>
                </thead>
                <tbody>
                  {result.equipment.map((e: any, i: number) => (
                    <tr key={i} className="border-t">
                      <td className="td">{e.categoryName}</td>
                      <td className="td text-right">{e.qty}</td>
                      <td className="td text-right">{formatZAR(e.unitCostCents)}</td>
                      <td className="td text-right">{formatZAR(e.lineCostCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <dl className="mt-4 grid grid-cols-2 gap-2 text-sm">
                <dt className="text-slate-500">Equipment</dt><dd className="text-right">{formatZAR(result.costs.equipmentCents)}</dd>
                <dt className="text-slate-500">Installation</dt><dd className="text-right">{formatZAR(result.costs.installationCents)}</dd>
                <dt className="text-slate-500">Travel</dt><dd className="text-right">{formatZAR(result.costs.travelCents)}</dd>
                <dt className="text-slate-500">Labour</dt><dd className="text-right">{formatZAR(result.costs.labourCents)}</dd>
                <dt className="text-slate-500">Contingency ({result.costs.contingencyPct}%)</dt>
                <dd className="text-right">{formatZAR(result.costs.contingencyCents)}</dd>
                <dt className="text-base font-semibold text-brand-800">Total</dt>
                <dd className="text-right text-base font-semibold text-brand-800">{formatZAR(result.costs.totalCents)}</dd>
              </dl>
            </>
          )}
        </section>
      </div>
    </>
  );
}
