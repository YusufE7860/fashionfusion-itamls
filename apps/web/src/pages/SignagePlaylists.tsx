import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { PageHeader } from '@/components/PageHeader';
import { useAuth } from '@/store/auth';
import { ArrowDown, ArrowUp, Plus, Save, Trash2, X } from 'lucide-react';

export function SignagePlaylists() {
  const qc = useQueryClient();
  const hasPerm = useAuth((s) => s.hasPermission);
  const canWrite = hasPerm('stores:write');

  const playlists = useQuery({ queryKey: ['signage-playlists'], queryFn: () => api.get('/signage/playlists').then((r) => r.data) });
  const videos    = useQuery({ queryKey: ['signage-videos'],    queryFn: () => api.get('/signage/videos').then((r) => r.data) });
  const stores    = useQuery({ queryKey: ['stores'],            queryFn: () => api.get('/stores').then((r) => r.data) });
  const regions   = useQuery({ queryKey: ['regions'],           queryFn: () => api.get('/regions').then((r) => r.data).catch(() => []) });
  const assigns   = useQuery({ queryKey: ['signage-assigns'],   queryFn: () => api.get('/signage/assignments').then((r) => r.data) });

  const [selected, setSelected] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEntity, setNewEntity] = useState<'FASHION_FUSION' | 'EVLV' | 'BOTH'>('FASHION_FUSION');
  const [filterEntity, setFilterEntity] = useState<'ALL' | 'FASHION_FUSION' | 'EVLV' | 'BOTH'>('ALL');

  const create = useMutation({
    mutationFn: () => api.post('/signage/playlists', { name: newName, entity: newEntity }).then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['signage-playlists'] }); setShowNew(false); setNewName(''); },
  });
  const del = useMutation({
    mutationFn: (id: string) => api.delete(`/signage/playlists/${id}`).then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['signage-playlists'] }); setSelected(null); },
  });
  const setItems = useMutation({
    mutationFn: ({ id, items }: any) => api.patch(`/signage/playlists/${id}/items`, { items }).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['signage-playlists'] }),
  });
  const assign = useMutation({
    mutationFn: (dto: any) => api.post('/signage/assignments', dto).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['signage-assigns'] }),
  });
  const unassign = useMutation({
    mutationFn: (id: string) => api.delete(`/signage/assignments/${id}`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['signage-assigns'] }),
  });

  const picked = playlists.data?.find((p: any) => p.id === selected);
  const [draft, setDraft] = useState<any[]>([]);
  function sync() {
    if (picked) setDraft(picked.items.map((it: any, i: number) => ({ videoId: it.videoId, order: i, filename: it.video.filename })));
  }
  if (picked && draft.length === 0 && picked.items.length > 0) sync();

  function move(i: number, dir: -1 | 1) {
    const items = [...draft];
    const t = i + dir; if (t < 0 || t >= items.length) return;
    [items[i], items[t]] = [items[t], items[i]];
    setDraft(items.map((it, idx) => ({ ...it, order: idx })));
  }
  function addVideo(v: any) {
    setDraft([...draft, { videoId: v.id, order: draft.length, filename: v.filename }]);
  }

  const myAssigns = (assigns.data ?? []).filter((a: any) => a.playlistId === selected);

  return (
    <>
      <PageHeader
        title="Signage — Playlists"
        subtitle="Order videos, then assign to a device, store or region"
        actions={canWrite && (
          <button className="btn-primary" onClick={() => setShowNew((v) => !v)}>
            <Plus size={13}/>{showNew ? 'Cancel' : 'New playlist'}
          </button>
        )}
      />

      {showNew && (
        <section className="card mb-4 p-3">
          <div className="flex items-end gap-2">
            <div className="flex-1">
              <label className="label">Playlist name</label>
              <input className="field" value={newName} onChange={(e) => setNewName(e.target.value)} />
            </div>
            <div>
              <label className="label">Brand</label>
              <select className="field" value={newEntity} onChange={(e) => setNewEntity(e.target.value as any)}>
                <option value="FASHION_FUSION">Fashion Fusion</option>
                <option value="EVLV">Evolve</option>
                <option value="BOTH">Both brands</option>
              </select>
            </div>
            <button className="btn-primary" disabled={!newName.trim() || create.isPending} onClick={() => create.mutate()}>
              <Save size={12}/>Create
            </button>
          </div>
        </section>
      )}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-[280px_1fr]">
        <section className="card p-0">
          <div className="border-b border-ink-500/10 p-2">
            <select className="field text-xs" value={filterEntity}
              onChange={(e) => setFilterEntity(e.target.value as any)}>
              <option value="ALL">All brands</option>
              <option value="FASHION_FUSION">Fashion Fusion</option>
              <option value="EVLV">Evolve</option>
              <option value="BOTH">Shared</option>
            </select>
          </div>
          <ul className="divide-y divide-ink-500/10">
            {playlists.data?.filter((p: any) => filterEntity === 'ALL' || (p.entity ?? 'FASHION_FUSION') === filterEntity).length === 0 && (
              <li className="p-4 text-center text-xs text-ink-300">No playlists for this filter.</li>
            )}
            {playlists.data?.filter((p: any) => filterEntity === 'ALL' || (p.entity ?? 'FASHION_FUSION') === filterEntity).map((p: any) => (
              <li key={p.id}>
                <button className={`flex w-full items-center justify-between px-3 py-2 text-left text-sm hover:bg-slate-50 ${selected === p.id ? 'bg-brand-50' : ''}`}
                  onClick={() => { setSelected(p.id); setDraft([]); }}>
                  <span className="flex items-center gap-2">
                    <span className={`rounded px-1 py-0.5 text-[9px] font-semibold ring-1 ${
                      p.entity === 'EVLV' ? 'bg-indigo-50 text-indigo-700 ring-indigo-300'
                        : p.entity === 'BOTH' ? 'bg-slate-100 text-slate-700 ring-slate-300'
                        : 'bg-brand-50 text-brand-700 ring-brand-300'
                    }`}>
                      {p.entity === 'EVLV' ? 'EVLV' : p.entity === 'BOTH' ? 'Both' : 'FF'}
                    </span>
                    <span>{p.name}</span>
                  </span>
                  <span className="text-[10px] text-ink-300">{p.items.length} items</span>
                </button>
              </li>
            ))}
          </ul>
        </section>

        {picked ? (
          <section className="space-y-4">
            <div className="card p-4">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="text-sm font-semibold">{picked.name}</h3>
                {canWrite && (
                  <div className="flex gap-1">
                    <button className="btn-primary" disabled={setItems.isPending}
                      onClick={() => setItems.mutate({ id: picked.id, items: draft.map((d, i) => ({ videoId: d.videoId, order: i })) })}>
                      <Save size={12}/>Save order
                    </button>
                    <button className="btn-ghost text-rose-500" onClick={() => { if (confirm(`Delete ${picked.name}?`)) del.mutate(picked.id); }}>
                      <Trash2 size={12}/>
                    </button>
                  </div>
                )}
              </div>
              <ol className="space-y-1">
                {draft.length === 0 && <li className="text-xs text-ink-300">Empty. Add videos below.</li>}
                {draft.map((it, i) => (
                  <li key={`${it.videoId}-${i}`} className="flex items-center gap-2 rounded border border-ink-500/10 bg-slate-50/40 p-2 text-xs">
                    <span className="w-6 font-mono text-ink-300">{i + 1}</span>
                    <span className="flex-1 font-mono">{it.filename}</span>
                    {canWrite && (
                      <div className="flex gap-0.5">
                        <button className="btn-ghost !p-1" onClick={() => move(i, -1)}><ArrowUp size={11}/></button>
                        <button className="btn-ghost !p-1" onClick={() => move(i, 1)}><ArrowDown size={11}/></button>
                        <button className="btn-ghost !p-1 text-rose-500" onClick={() => setDraft(draft.filter((_, j) => j !== i))}><X size={11}/></button>
                      </div>
                    )}
                  </li>
                ))}
              </ol>
            </div>

            {canWrite && (
              <div className="card p-4">
                <h4 className="mb-2 text-xs font-semibold text-ink-300">Add video</h4>
                <div className="flex flex-wrap gap-1">
                  {videos.data?.map((v: any) => (
                    <button key={v.id} className="rounded border border-ink-500/20 bg-white px-2 py-1 text-[11px] hover:border-brand-400"
                      onClick={() => addVideo(v)}>+ {v.filename}</button>
                  ))}
                </div>
              </div>
            )}

            <div className="card p-4">
              <h4 className="mb-2 text-xs font-semibold text-ink-300">Assignments</h4>
              <ul className="mb-3 space-y-1 text-xs">
                {myAssigns.length === 0 && <li className="text-ink-300">Not assigned anywhere.</li>}
                {myAssigns.map((a: any) => (
                  <li key={a.id} className="flex items-center justify-between rounded border border-ink-500/10 p-2">
                    <span>
                      {a.device ? `Device: ${a.device.name}` :
                       a.store  ? `Store: ${a.store.code} — ${a.store.name}` :
                       a.region ? `Region: ${a.region.code}` : '—'}
                    </span>
                    {canWrite && (
                      <button className="btn-ghost text-rose-500" onClick={() => unassign.mutate(a.id)}>
                        <Trash2 size={11}/>
                      </button>
                    )}
                  </li>
                ))}
              </ul>
              {canWrite && (
                <AssignPicker
                  stores={stores.data ?? []}
                  regions={regions.data ?? []}
                  onPick={(scope) => assign.mutate({ playlistId: picked.id, ...scope })}
                />
              )}
            </div>
          </section>
        ) : (
          <section className="card p-6 text-center text-sm text-ink-300">Pick a playlist on the left.</section>
        )}
      </div>
    </>
  );
}

function AssignPicker({ stores, regions, onPick }: { stores: any[]; regions: any[]; onPick: (scope: any) => void }) {
  const [scope, setScope] = useState<'store' | 'region'>('store');
  const [val, setVal] = useState('');
  return (
    <div className="flex items-end gap-2">
      <div>
        <label className="label">Scope</label>
        <select className="field" value={scope} onChange={(e) => { setScope(e.target.value as any); setVal(''); }}>
          <option value="store">Store</option>
          <option value="region">Region</option>
        </select>
      </div>
      <div className="flex-1">
        <label className="label">Target</label>
        <select className="field" value={val} onChange={(e) => setVal(e.target.value)}>
          <option value="">— pick —</option>
          {(scope === 'store' ? stores : regions).map((it: any) =>
            <option key={it.id} value={it.id}>{it.code} — {it.name}</option>
          )}
        </select>
      </div>
      <button className="btn-primary" disabled={!val}
        onClick={() => { onPick(scope === 'store' ? { storeId: val } : { regionId: val }); setVal(''); }}>
        Assign
      </button>
    </div>
  );
}
