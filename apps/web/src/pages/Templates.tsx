import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { PageHeader } from '@/components/PageHeader';
import { Plus, Trash2, Save, ChevronDown, ChevronRight } from 'lucide-react';

export function Templates() {
  const qc = useQueryClient();
  const templates = useQuery({ queryKey: ['store-templates'], queryFn: () => api.get('/store-templates').then((r) => r.data) });
  const categories = useQuery({ queryKey: ['categories'], queryFn: () => api.get('/categories').then((r) => r.data) });

  const [showNew, setShowNew] = useState(false);
  const [newTpl, setNewTpl] = useState({ code: '', name: '', description: '' });
  const createTpl = useMutation({
    mutationFn: (body: any) => api.post('/store-templates', { ...body, items: [] }).then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['store-templates'] }); setShowNew(false); setNewTpl({ code: '', name: '', description: '' }); },
  });

  return (
    <>
      <PageHeader
        title="Store Templates"
        subtitle="Define the IT equipment each store type must contain"
        actions={<button className="btn-primary" onClick={() => setShowNew(!showNew)}><Plus size={14}/>{showNew ? 'Cancel' : 'New template'}</button>}
      />

      {showNew && (
        <div className="card mb-4 p-4">
          <h3 className="mb-2 text-sm font-semibold text-white">Create template</h3>
          <div className="grid grid-cols-3 gap-3">
            <div><label className="label">Code</label>
              <input className="field" value={newTpl.code} onChange={(e) => setNewTpl({ ...newTpl, code: e.target.value.toUpperCase() })} placeholder="e.g. XLARGE" /></div>
            <div className="col-span-2"><label className="label">Name</label>
              <input className="field" value={newTpl.name} onChange={(e) => setNewTpl({ ...newTpl, name: e.target.value })} placeholder="e.g. Extra Large Store" /></div>
            <div className="col-span-3"><label className="label">Description (optional)</label>
              <input className="field" value={newTpl.description} onChange={(e) => setNewTpl({ ...newTpl, description: e.target.value })} /></div>
          </div>
          <button className="btn-primary mt-3" disabled={!newTpl.code || !newTpl.name || createTpl.isPending}
            onClick={() => createTpl.mutate(newTpl)}>Save</button>
        </div>
      )}

      <div className="space-y-3">
        {templates.data?.map((t: any) => (
          <TemplateCard key={t.id} template={t} categories={categories.data ?? []} />
        ))}
      </div>
    </>
  );
}

function TemplateCard({ template, categories }: { template: any; categories: any[] }) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(true);
  const [editName, setEditName] = useState(template.name);
  const [editDesc, setEditDesc] = useState(template.description ?? '');
  const [addCat, setAddCat] = useState('');
  const [addQty, setAddQty] = useState(1);

  const update = useMutation({
    mutationFn: (body: any) => api.patch(`/store-templates/${template.id}`, body).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['store-templates'] }),
  });
  const upsertItem = useMutation({
    mutationFn: (body: any) => api.post(`/store-templates/${template.id}/items`, body).then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['store-templates'] }); setAddCat(''); setAddQty(1); },
  });
  const removeItem = useMutation({
    mutationFn: (itemId: string) => api.delete(`/store-templates/${template.id}/items/${itemId}`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['store-templates'] }),
  });
  const removeTpl = useMutation({
    mutationFn: () => api.delete(`/store-templates/${template.id}`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['store-templates'] }),
    onError: (e: any) => alert(e.response?.data?.message ?? 'Delete failed'),
  });

  const usedCategoryIds = new Set(template.items.map((i: any) => i.categoryId));
  const availableCats = categories.filter((c: any) => !usedCategoryIds.has(c.id));

  return (
    <div className="card overflow-hidden">
      <button className="flex w-full items-center justify-between px-4 py-3 text-left"
              onClick={() => setOpen(!open)}>
        <div className="flex items-center gap-3">
          {open ? <ChevronDown size={16}/> : <ChevronRight size={16}/>}
          <div>
            <div className="font-mono text-xs text-brand-300">{template.code}</div>
            <div className="font-semibold text-white">{template.name}</div>
          </div>
        </div>
        <div className="text-xs text-ink-200">{template.items.length} categories</div>
      </button>

      {open && (
        <div className="border-t border-ink-500/40 p-4">
          <div className="mb-4 grid grid-cols-2 gap-3">
            <div><label className="label">Name</label>
              <input className="field" value={editName} onChange={(e) => setEditName(e.target.value)} /></div>
            <div><label className="label">Description</label>
              <input className="field" value={editDesc} onChange={(e) => setEditDesc(e.target.value)} /></div>
          </div>
          <div className="mb-4 flex gap-2">
            <button className="btn-primary"
                    disabled={editName === template.name && editDesc === (template.description ?? '')}
                    onClick={() => update.mutate({ name: editName, description: editDesc })}>
              <Save size={14}/>Save changes
            </button>
            <button className="btn-ghost text-rose-300 hover:text-rose-200"
                    onClick={() => { if (confirm(`Delete template "${template.name}"?`)) removeTpl.mutate(); }}>
              <Trash2 size={14}/>Delete template
            </button>
          </div>

          <h4 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-ink-200">Required equipment</h4>
          <table className="w-full">
            <thead><tr><th className="th">Category</th><th className="th text-right">Required qty</th><th className="th"></th></tr></thead>
            <tbody>
              {template.items.map((item: any) => (
                <tr key={item.id} className="border-t border-ink-500/30">
                  <td className="td">{item.category.name}</td>
                  <td className="td text-right font-mono">{item.requiredQty}</td>
                  <td className="td text-right">
                    <button className="btn-ghost text-rose-300" onClick={() => removeItem.mutate(item.id)}>
                      <Trash2 size={12}/>
                    </button>
                  </td>
                </tr>
              ))}
              <tr className="border-t border-ink-500/30">
                <td className="td">
                  <select className="field" value={addCat} onChange={(e) => setAddCat(e.target.value)}>
                    <option value="">+ Add category…</option>
                    {availableCats.map((c: any) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </td>
                <td className="td text-right">
                  <input type="number" min={1} className="field w-24 text-right" value={addQty}
                         onChange={(e) => setAddQty(+e.target.value)} />
                </td>
                <td className="td text-right">
                  <button className="btn-primary"
                          disabled={!addCat || addQty < 1 || upsertItem.isPending}
                          onClick={() => upsertItem.mutate({ categoryId: addCat, requiredQty: addQty })}>
                    <Plus size={12}/>Add
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
