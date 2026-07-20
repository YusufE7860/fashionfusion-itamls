import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { useAuth } from '@/store/auth';
import { PageHeader } from '@/components/PageHeader';
import { Plus, X, Sparkles } from 'lucide-react';

export function StoresList() {
  const qc = useQueryClient();
  const hasPerm = useAuth((s) => s.hasPermission);
  const stores = useQuery({ queryKey: ['stores'], queryFn: () => api.get('/stores').then((r) => r.data) });

  const [showNew, setShowNew] = useState(false);
  const templates = useQuery({
    queryKey: ['store-templates'],
    queryFn: () => api.get('/store-templates').then((r) => r.data),
    enabled: showNew,
  });

  const [form, setForm] = useState({
    code: '', name: '', region: '',
    entity: 'FASHION_FUSION',
    status: 'OPEN',
    templateId: '',
    openedAt: new Date().toISOString().slice(0, 10),
  });

  const create = useMutation({
    mutationFn: () => api.post('/stores', {
      ...form,
      templateId: form.templateId || undefined,
      openedAt: form.openedAt || undefined,
    }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['stores'] });
      setShowNew(false);
      setForm({ code:'', name:'', region:'', entity:'FASHION_FUSION', status:'OPEN', templateId:'',
                openedAt: new Date().toISOString().slice(0, 10) });
    },
    onError: (e: any) => alert(e.response?.data?.message ?? 'Could not create store'),
  });

  return (
    <>
      <PageHeader
        title="Stores"
        subtitle="Every Fashion Fusion retail location"
        actions={
          <>
            <Link to="/stores/wizard" className="btn-ghost"><Sparkles size={14}/>New store wizard</Link>
            {hasPerm('stores:write') &&
              <button className="btn-primary" onClick={() => setShowNew(!showNew)}>
                {showNew ? <><X size={14}/>Cancel</> : <><Plus size={14}/>Add existing store</>}
              </button>}
          </>
        }
      />

      {showNew && (
        <div className="card mb-4 p-4">
          <h3 className="mb-3 text-sm font-semibold text-ink-50">Register an existing store</h3>
          <p className="mb-3 text-xs text-ink-300">
            Use this to add a store that's already trading. For planning a <b>new</b> opening
            with equipment list and costs, use the New Store Wizard instead.
          </p>
          <div className="grid grid-cols-3 gap-3">
            <div><label className="label">Store code</label>
              <input className="field font-mono" value={form.code}
                     onChange={(e) => setForm({ ...form, code: e.target.value.toUpperCase() })}
                     placeholder="001 / STR-006 / E03" /></div>
            <div className="col-span-2"><label className="label">Store name</label>
              <input className="field" value={form.name}
                     onChange={(e) => setForm({ ...form, name: e.target.value })}
                     placeholder="Gateway" /></div>

            <div><label className="label">Region</label>
              <input className="field" value={form.region}
                     onChange={(e) => setForm({ ...form, region: e.target.value })}
                     placeholder="KZN / Gauteng / Western Cape" /></div>
            <div><label className="label">Entity</label>
              <select className="field" value={form.entity}
                      onChange={(e) => setForm({ ...form, entity: e.target.value })}>
                <option value="FASHION_FUSION">Fashion Fusion</option>
                <option value="EVLV">EVLV</option>
              </select></div>
            <div><label className="label">Status</label>
              <select className="field" value={form.status}
                      onChange={(e) => setForm({ ...form, status: e.target.value })}>
                <option value="OPEN">Open (trading)</option>
                <option value="PLANNED">Planned</option>
                <option value="OPENING">Opening soon</option>
                <option value="REMODEL">Remodel</option>
                <option value="CLOSED">Closed</option>
              </select></div>

            <div><label className="label">Opened on</label>
              <input type="date" className="field" value={form.openedAt}
                     onChange={(e) => setForm({ ...form, openedAt: e.target.value })} /></div>
            <div className="col-span-2"><label className="label">Store template (optional)</label>
              <select className="field" value={form.templateId}
                      onChange={(e) => setForm({ ...form, templateId: e.target.value })}>
                <option value="">— None (assign later) —</option>
                {templates.data?.map((t: any) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <p className="mt-1 text-[11px] text-ink-400">
                The template drives the Store Standards Compliance check (which IT equipment this store must contain).
              </p></div>
          </div>
          <button className="btn-primary mt-4"
                  disabled={!form.code || !form.name || !form.region || create.isPending}
                  onClick={() => create.mutate()}>
            {create.isPending ? 'Creating…' : 'Create store'}
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
        {stores.data?.map((s: any) => (
          <Link key={s.id} to={`/stores/${s.id}`} className="card card-hover p-4">
            <div className="flex items-center justify-between">
              <div className="text-xs uppercase tracking-wide text-ink-400">{s.region}</div>
              <span className={s.entity === 'EVLV' ? 'pill-gold' : 'pill-brand'}>
                {s.entity === 'EVLV' ? 'EVLV' : 'FF'}
              </span>
            </div>
            <div className="mt-1 text-lg font-semibold text-ink-50">{s.code} – {s.name}</div>
            <div className="mt-2 text-sm text-ink-300">Template: {s.template?.name ?? '—'}</div>
            <div className="text-xs text-ink-400">Status: {s.status}</div>
          </Link>
        ))}
        {stores.data?.length === 0 && (
          <div className="card col-span-full p-6 text-center text-sm text-ink-300">
            No stores yet. Click <b>Add existing store</b> above.
          </div>
        )}
      </div>
    </>
  );
}
