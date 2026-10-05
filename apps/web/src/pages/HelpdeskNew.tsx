import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { PageHeader } from '@/components/PageHeader';
import { useAuth } from '@/store/auth';
import { Save, X, AlertCircle } from 'lucide-react';

export function HelpdeskNew() {
  const nav = useNavigate();
  const user = useAuth((s) => s.user);
  const hasPerm = useAuth((s) => s.hasPermission);
  const isAllStores = hasPerm('tickets:read:all');

  const stores     = useQuery({ queryKey: ['stores'],     queryFn: () => api.get('/stores').then((r) => r.data) });
  const categories = useQuery({ queryKey: ['hd-cats'],    queryFn: () => api.get('/helpdesk/categories').then((r) => r.data) });
  const departments= useQuery({ queryKey: ['depts'],      queryFn: () => api.get('/departments').then((r) => r.data).catch(() => []) });

  const [form, setForm] = useState({
    subject: '', description: '',
    categoryId: '', priority: 'P3' as 'P1'|'P2'|'P3'|'P4',
    storeId:  user?.storeId ?? '',
    departmentId: '',
    assetId: '',
  });

  // Category MUST be chosen first — only then do subject/description show.
  // Keeps data clean and nudges the reporter towards the right template.
  const pickedCategory = categories.data?.find((c: any) => c.id === form.categoryId);
  const showDescription = !!pickedCategory;

  // Load assets available for the selected store (if any)
  const assets = useQuery({
    queryKey: ['assets-for-store', form.storeId],
    queryFn: () => api.get('/assets', { params: { assignedStoreId: form.storeId } }).then((r) => r.data),
    enabled: !!form.storeId,
  });

  const create = useMutation({
    mutationFn: () => api.post('/helpdesk/tickets', {
      subject: form.subject,
      description: form.description,
      categoryId: form.categoryId,
      priority: form.priority,
      storeId: form.storeId || undefined,
      departmentId: form.departmentId || undefined,
      assetId: form.assetId || undefined,
      source: 'APP',
    }).then((r) => r.data),
    onSuccess: (t: any) => { nav(`/helpdesk/tickets/${t.id}`); },
  });

  const canSubmit = form.subject.trim().length > 3 && form.description.trim().length > 3 && !!form.categoryId;

  // Suggest priority when category changes (use the category's default)
  const suggestPriority = useMemo(() => {
    const c = categories.data?.find((x: any) => x.id === form.categoryId);
    return c?.defaultPriority ?? 'P3';
  }, [form.categoryId, categories.data]);

  return (
    <>
      <PageHeader
        title="Log a call"
        subtitle="Tell us what's happening. IT will pick it up based on category."
        actions={<button className="btn-ghost" onClick={() => nav(-1)}><X size={13}/>Cancel</button>}
      />

      <section className="card p-4">
        {/* Step 1: Category picker as big tiles */}
        <div className="mb-4">
          <label className="label">1. Pick a category</label>
          <div className="grid grid-cols-2 gap-2 md:grid-cols-4">
            {categories.data?.filter?.((c: any) => c.isActive !== false)?.map((c: any) => (
              <button key={c.id} type="button"
                className={`rounded-lg border p-3 text-left transition-colors ${
                  form.categoryId === c.id
                    ? 'border-brand-500 bg-brand-50 text-brand-800 ring-2 ring-brand-400'
                    : 'border-ink-500 bg-white text-ink-100 hover:border-brand-400 hover:bg-brand-50/40'
                }`}
                onClick={() => setForm({
                  ...form,
                  categoryId: c.id,
                  priority: (c.defaultPriority ?? form.priority),
                  description: form.description || c.issueTemplate || '',
                })}>
                <div className="text-xs font-semibold uppercase tracking-wider">{c.code}</div>
                <div className="text-sm font-medium">{c.name}</div>
                {c.description && <div className="mt-1 text-[11px] text-ink-300">{c.description}</div>}
              </button>
            ))}
          </div>
        </div>

      {!showDescription && (
        <div className="rounded-lg border border-dashed border-ink-500 bg-slate-50 p-6 text-center text-sm text-ink-300">
          Pick a category above to continue.
        </div>
      )}

      {showDescription && (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div className="md:col-span-3">
            <label className="label">2. What's the problem? *</label>
            <input className="field" placeholder="e.g. POS3 won't print receipts" maxLength={200}
              value={form.subject} onChange={(e) => setForm({ ...form, subject: e.target.value })} />
          </div>
          <div>
            <label className="label">Priority *</label>
            <select className="field" value={form.priority}
              onChange={(e) => setForm({ ...form, priority: e.target.value as any })}>
              <option value="P1">P1 — Critical (POS down, network down)</option>
              <option value="P2">P2 — High (multiple users affected)</option>
              <option value="P3">P3 — Standard (single user, workaround exists)</option>
              <option value="P4">P4 — Low (request, question)</option>
            </select>
            {form.priority !== suggestPriority && (
              <p className="mt-1 text-[11px] text-amber-600">
                Category default is {suggestPriority} — check you actually need this priority.
              </p>
            )}
          </div>
          <div>
            <label className="label">Store</label>
            <select className="field" value={form.storeId} disabled={!isAllStores && !!user?.storeId}
              onChange={(e) => setForm({ ...form, storeId: e.target.value, assetId: '' })}>
              <option value="">— HQ / not store-specific —</option>
              {stores.data?.map((s: any) => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
            </select>
          </div>

          {!form.storeId && (
            <div className="md:col-span-3">
              <label className="label">HQ Department (optional)</label>
              <select className="field" value={form.departmentId}
                onChange={(e) => setForm({ ...form, departmentId: e.target.value })}>
                <option value="">— none —</option>
                {departments.data?.filter?.((d: any) => d.isActive)?.map((d: any) => (
                  <option key={d.id} value={d.id}>{d.name}</option>
                ))}
              </select>
            </div>
          )}

          {form.storeId && (
            <div className="md:col-span-3">
              <label className="label">Affected asset (optional)</label>
              <select className="field" value={form.assetId}
                onChange={(e) => setForm({ ...form, assetId: e.target.value })}>
                <option value="">— none —</option>
                {assets.data?.map((a: any) => (
                  <option key={a.id} value={a.id}>
                    {a.assetTag} — {a.sku?.name} {a.serialNo ? `(SN ${a.serialNo})` : ''}
                  </option>
                ))}
              </select>
              <p className="mt-1 text-[11px] text-ink-300">Linking an asset makes reports and history much richer. Skip if unsure.</p>
            </div>
          )}

          <div className="md:col-span-3">
            <label className="label">3. Describe what's happening *</label>
            {pickedCategory?.issueTemplate && !form.description && (
              <p className="mb-1 text-[11px] text-amber-600">
                A template was loaded for this category — fill in the blanks.
              </p>
            )}
            <textarea className="field font-mono text-sm" rows={10}
              placeholder="What did you try? When did it start? Any error messages? Steps to reproduce?"
              value={form.description} onChange={(e) => setForm({ ...form, description: e.target.value })} />
            <p className="mt-1 text-[11px] text-ink-300">
              The more detail here, the faster IT resolves. Screenshots: attach them on the ticket page right after you log it.
            </p>
          </div>
        </div>
      )}

        <div className="mt-4 flex items-center gap-2">
          <button className="btn-primary" disabled={!canSubmit || create.isPending} onClick={() => create.mutate()}>
            <Save size={13}/>{create.isPending ? 'Logging…' : 'Log call'}
          </button>
          <button className="btn-ghost" onClick={() => nav(-1)}>Cancel</button>
          {create.isError && (
            <span className="ml-2 inline-flex items-center gap-1 text-xs text-rose-600">
              <AlertCircle size={12}/>{(create.error as any)?.response?.data?.message ?? 'Failed to log'}
            </span>
          )}
        </div>
      </section>
    </>
  );
}
