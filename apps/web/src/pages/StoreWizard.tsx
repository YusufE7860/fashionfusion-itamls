import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { PageHeader } from '@/components/PageHeader';
import { formatZAR } from '@itamls/shared';
import { Download, Check, FileText, AlertCircle } from 'lucide-react';
import { useAuth } from '@/store/auth';
import { Link } from 'react-router-dom';

// --------------------------------------------------------------------------
// Flow:
//   1. Brand   → Fashion Fusion / Evolve / My Brands
//   2. Name    → free text
//   3. Template → Small / Medium / Large / Flagship / Custom
//   4. If Custom → manual POS / Offices / Printers / Monitors
//   5. Generate proposal → shows equipment + costs
//   6. Download PDF checklist
//   7. Commit → auto-creates the store in /stores with a generated code
// --------------------------------------------------------------------------

type Entity = 'FASHION_FUSION' | 'EVLV' | 'BOTH';

const ENTITY_LABEL: Record<Entity, string> = {
  FASHION_FUSION: 'Fashion Fusion',
  EVLV:           'Evolve',
  BOTH:           'My Brands',
};

const ENTITY_TONE: Record<Entity, string> = {
  FASHION_FUSION: 'border-brand-300 bg-brand-50 text-brand-700',
  EVLV:           'border-indigo-300 bg-indigo-50 text-indigo-700',
  BOTH:           'border-slate-300 bg-slate-50 text-slate-700',
};

export function StoreWizard() {
  const token = useAuth((s) => s.token);
  const templates = useQuery({
    queryKey: ['templates'],
    queryFn: () => api.get<any[]>('/store-templates').then((r) => r.data),
  });

  const [entity, setEntity]       = useState<Entity | ''>('');
  const [name, setName]           = useState('');
  const [region, setRegion]       = useState('KZN');
  const [templateId, setTemplateId] = useState('');
  const [custom, setCustom] = useState({ posPoints: 4, offices: 1, printers: 4, screens: 4 });
  const [contingencyPct, setContingencyPct] = useState(10);
  // Store-registration fields mirror the "Register existing store" form so a
  // single commit creates a fully-populated Store row — no second edit pass.
  const [storeCode, setStoreCode]       = useState('');
  const [status, setStatus]             = useState('PLANNED');
  const [openedAt, setOpenedAt]         = useState('');
  const [areaManagerId, setAreaManagerId] = useState('');
  const [contactEmail, setContactEmail] = useState('');

  const areaManagers = useQuery({
    queryKey: ['area-managers'],
    queryFn: () => api.get<any[]>('/area-managers').then((r) => r.data).catch(() => []),
  });

  const [result, setResult]       = useState<any>(null);
  const [loading, setLoading]     = useState(false);
  const [error, setError]         = useState<string | null>(null);
  const [committed, setCommitted] = useState<any>(null);

  const selectedTemplate = useMemo(
    () => templates.data?.find((t: any) => t.id === templateId),
    [templates.data, templateId],
  );
  const isCustom = (selectedTemplate?.code ?? '').toUpperCase() === 'CUSTOM';

  const canGenerate = !!entity && name.trim().length > 1 && !!templateId;
  const payload = () => ({
    name: name.trim(),
    entity,
    templateId,
    region,
    contingencyPct,
    ...(isCustom ? custom : {}),
    // Store registration metadata — safe to send on preview too (server
    // only uses these on commit).
    storeCode:     storeCode.trim() || undefined,
    status,
    openedAt:      openedAt || undefined,
    areaManagerId: areaManagerId || undefined,
    contactEmail:  contactEmail.trim() || undefined,
  });

  async function generate() {
    if (!canGenerate) return;
    setLoading(true); setError(null); setCommitted(null);
    try {
      const { data } = await api.post('/stores/wizard', payload());
      setResult(data);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'Failed to generate proposal');
    } finally {
      setLoading(false);
    }
  }

  async function commit() {
    if (!result) return;
    if (!confirm(`Create "${name}" as a ${ENTITY_LABEL[entity as Entity]} store? A store record will be added to the Stores list.`)) return;
    setLoading(true); setError(null);
    try {
      const { data } = await api.post('/stores/wizard', { ...payload(), commit: true });
      setCommitted(data.createdStore);
      setResult(data);
    } catch (e: any) {
      setError(e?.response?.data?.message ?? 'Failed to create store');
    } finally {
      setLoading(false);
    }
  }

  async function downloadPdf() {
    const base = (api.defaults.baseURL ?? '').replace(/\/$/, '')
      || `${window.location.origin}/api/v1`;
    const res = await fetch(`${base}/stores/wizard/pdf`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify(payload()),
    });
    if (!res.ok) {
      setError('PDF generation failed — ' + res.statusText);
      return;
    }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `proposal-${name.replace(/[^A-Za-z0-9_-]+/g, '_') || 'store'}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <PageHeader
        title="New Store Wizard"
        subtitle="Pick a brand → name the store → pick a template → review & commit"
      />

      {/* ---------- Step 1: brand ---------- */}
      <section className="card mb-4 p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">1. Brand</h2>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
          {(['FASHION_FUSION', 'EVLV', 'BOTH'] as Entity[]).map((e) => {
            const picked = entity === e;
            return (
              <button key={e}
                onClick={() => setEntity(e)}
                className={`rounded-lg border-2 p-3 text-left transition-colors ${
                  picked
                    ? ENTITY_TONE[e]
                    : 'border-ink-500 hover:border-brand-400 hover:bg-brand-50'
                }`}>
                <div className="flex items-center gap-2">
                  {picked && <Check size={14}/>}
                  <span className="font-semibold">{ENTITY_LABEL[e]}</span>
                </div>
                <div className="mt-1 text-xs text-ink-300">
                  {e === 'FASHION_FUSION' && 'Code prefix FFN'}
                  {e === 'EVLV'           && 'Code prefix EVL'}
                  {e === 'BOTH'           && 'Shared location (code prefix MB)'}
                </div>
              </button>
            );
          })}
        </div>
      </section>

      {/* ---------- Step 2: name + region ---------- */}
      <section className={`card mb-4 p-4 ${!entity ? 'opacity-50 pointer-events-none' : ''}`}>
        <h2 className="mb-3 text-sm font-semibold text-slate-700">2. Store details</h2>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Store name</label>
            <input className="field" value={name} placeholder="e.g. Westgate Mall"
              onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label className="label">Region</label>
            <input className="field" value={region}
              onChange={(e) => setRegion(e.target.value)} />
          </div>
        </div>
      </section>

      {/* ---------- Step 3: template ---------- */}
      <section className={`card mb-4 p-4 ${(!entity || name.trim().length < 2) ? 'opacity-50 pointer-events-none' : ''}`}>
        <h2 className="mb-3 text-sm font-semibold text-slate-700">3. Template</h2>
        {templates.isLoading && <div className="text-xs text-ink-300">Loading templates…</div>}
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {templates.data?.map((t: any) => {
            const picked = templateId === t.id;
            const custom = (t.code ?? '').toUpperCase() === 'CUSTOM';
            return (
              <button key={t.id}
                onClick={() => setTemplateId(t.id)}
                className={`rounded-lg border-2 p-3 text-left transition-colors ${
                  picked
                    ? 'border-brand-500 bg-brand-50'
                    : 'border-ink-500 hover:border-brand-400 hover:bg-brand-50'
                }`}>
                <div className="flex items-center gap-2 font-semibold">
                  {picked && <Check size={14}/>}
                  {t.name}
                  {custom && <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700">manual</span>}
                </div>
                <div className="mt-1 text-xs text-ink-300">
                  {custom
                    ? 'Enter quantities below'
                    : `${t.items?.length ?? 0} fixed line item(s)`}
                </div>
              </button>
            );
          })}
        </div>

        {isCustom && (
          <div className="mt-4 rounded-lg border border-amber-200 bg-amber-50 p-3">
            <div className="mb-2 text-xs font-semibold text-amber-800">Custom quantities</div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              <div>
                <label className="label">POS points</label>
                <input type="number" className="field" min={0} value={custom.posPoints}
                  onChange={(e) => setCustom({ ...custom, posPoints: +e.target.value })}/>
              </div>
              <div>
                <label className="label">Office PCs</label>
                <input type="number" className="field" min={0} value={custom.offices}
                  onChange={(e) => setCustom({ ...custom, offices: +e.target.value })}/>
              </div>
              <div>
                <label className="label">Printers</label>
                <input type="number" className="field" min={0} value={custom.printers}
                  onChange={(e) => setCustom({ ...custom, printers: +e.target.value })}/>
              </div>
              <div>
                <label className="label">Monitors</label>
                <input type="number" className="field" min={0} value={custom.screens}
                  onChange={(e) => setCustom({ ...custom, screens: +e.target.value })}/>
              </div>
            </div>
          </div>
        )}
      </section>

      {/* ---------- Step 4: store registration details ---------- */}
      <section className={`card mb-4 p-4 ${(!entity || !templateId) ? 'opacity-50 pointer-events-none' : ''}`}>
        <h2 className="mb-1 text-sm font-semibold text-slate-700">4. Store registration</h2>
        <p className="mb-3 text-xs text-ink-300">
          These populate the Store record when you click <b>Create store</b>. Leave the code blank to
          auto-generate one from the brand prefix (FFN/EVL/MB).
        </p>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
          <div>
            <label className="label">Store code <span className="text-ink-400">(optional)</span></label>
            <input className="field font-mono" value={storeCode}
              onChange={(e) => setStoreCode(e.target.value.toUpperCase())}
              placeholder="auto (e.g. FFN0042)"/>
          </div>
          <div>
            <label className="label">Status</label>
            <select className="field" value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="PLANNED">Planned</option>
              <option value="OPENING">Opening soon</option>
              <option value="OPEN">Open (trading)</option>
              <option value="REMODEL">Remodel</option>
              <option value="CLOSED">Closed</option>
            </select>
          </div>
          <div>
            <label className="label">Opened on <span className="text-ink-400">(optional)</span></label>
            <input type="date" className="field" value={openedAt}
              onChange={(e) => setOpenedAt(e.target.value)}/>
          </div>
          <div>
            <label className="label">Area Manager</label>
            <select className="field" value={areaManagerId}
              onChange={(e) => setAreaManagerId(e.target.value)}>
              <option value="">— Unassigned —</option>
              {areaManagers.data?.map((am: any) => (
                <option key={am.id} value={am.id}>
                  {am.fullName}{am.region ? ` (${am.region.code})` : ''}
                </option>
              ))}
            </select>
          </div>
          <div className="sm:col-span-2">
            <label className="label">Store contact email <span className="text-ink-400">(auto-creates store login)</span></label>
            <input type="email" className="field" value={contactEmail}
              onChange={(e) => setContactEmail(e.target.value)}
              placeholder="store042@fashionfusion.co.za"/>
            <p className="mt-1 text-[11px] text-ink-400">
              If supplied, a STORE_MANAGER login is created so this store can log IT tickets from day one.
            </p>
          </div>
        </div>
      </section>

      {/* ---------- Action row ---------- */}
      <section className="card mb-4 flex flex-wrap items-center gap-3 p-4">
        <div className="flex-1">
          <label className="label">Contingency %</label>
          <input type="number" className="field w-24" min={0} max={50} value={contingencyPct}
            onChange={(e) => setContingencyPct(+e.target.value)}/>
        </div>
        <button className="btn-primary" disabled={!canGenerate || loading} onClick={generate}>
          {loading ? 'Working…' : 'Generate proposal'}
        </button>
      </section>

      {error && (
        <div className="mb-4 flex items-center gap-2 rounded border border-rose-200 bg-rose-50 p-3 text-sm text-rose-800">
          <AlertCircle size={14}/>{error}
        </div>
      )}

      {/* ---------- Proposal result ---------- */}
      {result && (
        <section className="card p-4">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
            <h2 className="text-sm font-semibold text-slate-700">Proposal</h2>
            <div className="flex flex-wrap gap-2">
              <button className="btn-ghost" onClick={downloadPdf}>
                <Download size={13}/>Download PDF checklist
              </button>
              {!committed && (
                <button className="btn-primary" disabled={loading} onClick={commit}>
                  <FileText size={13}/>Create store
                </button>
              )}
            </div>
          </div>

          {committed && (
            <div className="mb-3 space-y-2">
              <div className="flex items-center gap-2 rounded border border-emerald-200 bg-emerald-50 p-3 text-sm text-emerald-800">
                <Check size={14}/>
                <span>
                  Store <b>{committed.code} — {committed.name}</b> created.{' '}
                  <Link to={`/stores`} className="font-semibold underline hover:text-emerald-900">Open the Stores list</Link>
                </span>
              </div>
              {committed.login?.tempPassword && (
                <div className="rounded border border-amber-200 bg-amber-50 p-3 text-xs text-amber-900">
                  <b>Store manager login created.</b> Share these once — the password is hashed on save and can't be shown again:
                  <div className="mt-2 font-mono">
                    <div>Email:     <b>{committed.login.email}</b></div>
                    <div>Password:  <b>{committed.login.tempPassword}</b></div>
                  </div>
                </div>
              )}
              {committed.__loginWarning && (
                <div className="rounded border border-rose-200 bg-rose-50 p-3 text-xs text-rose-800">
                  Store created, but the store-manager login couldn't be auto-provisioned: {committed.__loginWarning}
                </div>
              )}
            </div>
          )}

          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="th text-left">Item</th>
                <th className="th text-right">Qty</th>
                <th className="th text-right">Unit</th>
                <th className="th text-right">Line</th>
              </tr>
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
            <dt className="text-slate-500">Equipment</dt>
            <dd className="text-right">{formatZAR(result.costs.equipmentCents)}</dd>
            <dt className="text-slate-500">Installation</dt>
            <dd className="text-right">{formatZAR(result.costs.installationCents)}</dd>
            <dt className="text-slate-500">Travel</dt>
            <dd className="text-right">{formatZAR(result.costs.travelCents)}</dd>
            <dt className="text-slate-500">Labour</dt>
            <dd className="text-right">{formatZAR(result.costs.labourCents)}</dd>
            <dt className="text-slate-500">Contingency ({result.costs.contingencyPct}%)</dt>
            <dd className="text-right">{formatZAR(result.costs.contingencyCents)}</dd>
            <dt className="col-span-2 border-t border-ink-500/20 pt-2 text-base font-semibold text-brand-800">
              Total
            </dt>
            <dd className="text-right text-base font-semibold text-brand-800">
              {formatZAR(result.costs.totalCents)}
            </dd>
          </dl>
        </section>
      )}
    </>
  );
}
