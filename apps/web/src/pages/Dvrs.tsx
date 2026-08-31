import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { PageHeader } from '@/components/PageHeader';
import { useAuth } from '@/store/auth';
import {
  AlertCircle, Camera, Copy, ExternalLink, Pencil, Plus, RefreshCw, Save, Trash2, Video, X,
} from 'lucide-react';

type StoreT = { id: string; code: string; name: string };
type Dvr = {
  id: string; storeId: string; name: string;
  brand: 'DAHUA' | 'HIKVISION' | 'OTHER';
  model?: string; serialNo?: string;
  ipAddress: string; httpPort: number; rtspPort: number;
  channels: number; username: string; password?: string;
  notes?: string; lastSeenAt?: string;
  store?: StoreT;
};
type Endpoints = {
  dvrId: string; brand: string; webUrl: string;
  rtspByChannel: { channel: number; url: string }[];
};

const emptyForm = {
  name: '', brand: 'DAHUA' as Dvr['brand'], model: '', serialNo: '',
  ipAddress: '', httpPort: 80, rtspPort: 554, channels: 4,
  username: 'admin', password: '', notes: '',
};

export function Dvrs() {
  const qc = useQueryClient();
  const hasPerm = useAuth((s) => s.hasPermission);
  const token = useAuth((s) => s.token);
  const canWrite = hasPerm('dvrs:write');

  const stores = useQuery({ queryKey: ['stores'], queryFn: () => api.get<StoreT[]>('/stores').then((r) => r.data) });
  const dvrs = useQuery({ queryKey: ['dvrs'], queryFn: () => api.get<Dvr[]>('/dvrs').then((r) => r.data) });

  const [storeFilter, setStoreFilter] = useState('');
  const [q, setQ] = useState('');

  const [addForStoreId, setAddForStoreId] = useState<string | null>(null);
  const [form, setForm] = useState({ ...emptyForm });
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedDvr, setSelectedDvr] = useState<Dvr | null>(null);

  const filtered = useMemo(() => {
    let list = dvrs.data ?? [];
    if (storeFilter) list = list.filter((d) => d.storeId === storeFilter);
    if (q.trim()) {
      const needle = q.trim().toLowerCase();
      list = list.filter((d) =>
        d.name.toLowerCase().includes(needle) ||
        d.ipAddress.toLowerCase().includes(needle) ||
        (d.serialNo ?? '').toLowerCase().includes(needle) ||
        (d.model ?? '').toLowerCase().includes(needle) ||
        (d.store?.code ?? '').toLowerCase().includes(needle) ||
        (d.store?.name ?? '').toLowerCase().includes(needle),
      );
    }
    return list;
  }, [dvrs.data, storeFilter, q]);

  // Group by store for the cards view
  const grouped = useMemo(() => {
    const map = new Map<string, { store: StoreT; dvrs: Dvr[] }>();
    for (const d of filtered) {
      if (!d.store) continue;
      const bucket = map.get(d.storeId) ?? { store: d.store, dvrs: [] };
      bucket.dvrs.push(d);
      map.set(d.storeId, bucket);
    }
    return [...map.values()].sort((a, b) => a.store.code.localeCompare(b.store.code));
  }, [filtered]);

  const create = useMutation({
    mutationFn: () => api.post<Dvr>(`/stores/${addForStoreId}/dvrs`, form).then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['dvrs'] }); resetForm(); },
  });
  const update = useMutation({
    mutationFn: () => api.patch<Dvr>(`/dvrs/${editingId}`, form).then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['dvrs'] }); resetForm(); },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/dvrs/${id}`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['dvrs'] }),
  });

  function resetForm() {
    setForm({ ...emptyForm });
    setAddForStoreId(null);
    setEditingId(null);
  }
  function startEdit(d: Dvr) {
    setEditingId(d.id); setAddForStoreId(d.storeId);
    setForm({
      name: d.name, brand: d.brand, model: d.model ?? '', serialNo: d.serialNo ?? '',
      ipAddress: d.ipAddress, httpPort: d.httpPort, rtspPort: d.rtspPort,
      channels: d.channels, username: d.username, password: '',
      notes: d.notes ?? '',
    });
  }

  return (
    <>
      <PageHeader
        title="CCTV / DVRs"
        subtitle="Track and monitor Dahua & Hikvision DVRs at every store"
        actions={<button className="btn-ghost" onClick={() => dvrs.refetch()}><RefreshCw size={13} />Refresh</button>}
      />

      {/* Filters */}
      <section className="card mb-4 p-3">
        <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
          <div>
            <label className="label">Store</label>
            <select className="field" value={storeFilter} onChange={(e) => setStoreFilter(e.target.value)}>
              <option value="">All stores</option>
              {stores.data?.map((s) => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
            </select>
          </div>
          <div className="md:col-span-2">
            <label className="label">Search</label>
            <input className="field" value={q} onChange={(e) => setQ(e.target.value)}
              placeholder="DVR name / IP / serial / store code" />
          </div>
          <div className="flex items-end">
            <button className="btn-ghost w-full" onClick={() => { setStoreFilter(''); setQ(''); }}>Clear</button>
          </div>
        </div>
      </section>

      {/* Add / edit form */}
      {(addForStoreId || editingId) && (
        <section className="card mb-4 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-700">
              {editingId ? 'Edit DVR' : 'Add DVR'}
            </h3>
            <button className="btn-ghost" onClick={resetForm}><X size={13} /></button>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-4">
            <div><label className="label">Store</label>
              <select className="field" disabled={!!editingId}
                value={addForStoreId ?? ''} onChange={(e) => setAddForStoreId(e.target.value)}>
                <option value="">Pick a store…</option>
                {stores.data?.map((s) => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
              </select></div>
            <div><label className="label">Name *</label>
              <input className="field" value={form.name} placeholder="Front cameras"
                onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
            <div><label className="label">Brand</label>
              <select className="field" value={form.brand}
                onChange={(e) => setForm({ ...form, brand: e.target.value as any })}>
                <option value="DAHUA">Dahua</option>
                <option value="HIKVISION">Hikvision</option>
                <option value="OTHER">Other</option>
              </select></div>
            <div><label className="label">Channels</label>
              <input type="number" className="field" min={1} max={64}
                value={form.channels} onChange={(e) => setForm({ ...form, channels: +e.target.value })} /></div>

            <div><label className="label">Model</label>
              <input className="field" value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} /></div>
            <div><label className="label">Serial no.</label>
              <input className="field" value={form.serialNo} onChange={(e) => setForm({ ...form, serialNo: e.target.value })} /></div>
            <div><label className="label">IP address *</label>
              <input className="field font-mono" placeholder="10.168.117.20"
                value={form.ipAddress} onChange={(e) => setForm({ ...form, ipAddress: e.target.value })} /></div>
            <div><label className="label">HTTP port / RTSP port</label>
              <div className="flex gap-2">
                <input type="number" className="field" value={form.httpPort}
                  onChange={(e) => setForm({ ...form, httpPort: +e.target.value })} />
                <input type="number" className="field" value={form.rtspPort}
                  onChange={(e) => setForm({ ...form, rtspPort: +e.target.value })} />
              </div></div>

            <div><label className="label">Username</label>
              <input className="field" value={form.username} onChange={(e) => setForm({ ...form, username: e.target.value })} /></div>
            <div><label className="label">Password {editingId && '(leave blank to keep current)'}</label>
              <input type="password" className="field" value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })} /></div>
            <div className="md:col-span-2"><label className="label">Notes</label>
              <input className="field" value={form.notes}
                onChange={(e) => setForm({ ...form, notes: e.target.value })} /></div>
          </div>
          <div className="mt-3 flex items-center gap-2">
            <button className="btn-primary"
              disabled={!form.name.trim() || !form.ipAddress.trim() || (!editingId && !form.password.trim()) || !addForStoreId
                || create.isPending || update.isPending}
              onClick={() => (editingId ? update.mutate() : create.mutate())}>
              <Save size={13} />
              {editingId ? (update.isPending ? 'Saving…' : 'Save changes') : (create.isPending ? 'Adding…' : 'Add DVR')}
            </button>
            <button className="btn-ghost" onClick={resetForm}>Cancel</button>
            {(create.isError || update.isError) && (
              <span className="text-xs text-rose-600">
                {((create.error ?? update.error) as any)?.response?.data?.message ?? 'Failed'}
              </span>
            )}
          </div>
        </section>
      )}

      {/* Store cards */}
      <div className="space-y-4">
        {grouped.map(({ store, dvrs }) => (
          <section key={store.id} className="card p-4">
            <div className="mb-3 flex items-center justify-between">
              <div>
                <div className="text-xs uppercase tracking-wider text-ink-300">{store.code}</div>
                <h2 className="text-base font-semibold text-ink-50">{store.name}</h2>
              </div>
              {canWrite && (
                <button className="btn-ghost" onClick={() => { setAddForStoreId(store.id); setEditingId(null); setForm({ ...emptyForm }); }}>
                  <Plus size={12} />Add DVR to this store
                </button>
              )}
            </div>
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2 lg:grid-cols-3">
              {dvrs.map((d) => (
                <DvrCard key={d.id} dvr={d} token={token ?? ''}
                  canWrite={canWrite}
                  onView={() => setSelectedDvr(d)}
                  onEdit={() => startEdit(d)}
                  onDelete={() => {
                    if (window.confirm(`Delete DVR "${d.name}" at ${store.code}?`)) remove.mutate(d.id);
                  }} />
              ))}
            </div>
          </section>
        ))}
        {grouped.length === 0 && (
          <div className="card p-8 text-center text-sm text-ink-300">
            <Camera size={28} className="mx-auto mb-2 opacity-40" />
            {stores.data?.length === 0
              ? 'Add a store first, then you can register its DVRs.'
              : 'No DVRs registered yet.'}
            {canWrite && stores.data && stores.data.length > 0 && (
              <div className="mt-3">
                <button className="btn-primary" onClick={() => { setAddForStoreId(stores.data![0].id); setForm({ ...emptyForm }); }}>
                  <Plus size={12} />Add your first DVR
                </button>
              </div>
            )}
          </div>
        )}
      </div>

      {/* Viewer modal */}
      {selectedDvr && (
        <DvrViewer dvr={selectedDvr} token={token ?? ''} onClose={() => setSelectedDvr(null)} />
      )}
    </>
  );
}

// -------- DVR card (thumbnail of channel 1) --------
function DvrCard({ dvr, token, canWrite, onView, onEdit, onDelete }: {
  dvr: Dvr; token: string; canWrite: boolean;
  onView: () => void; onEdit: () => void; onDelete: () => void;
}) {
  const [bust, setBust] = useState(Date.now());
  const src = `${api.defaults.baseURL}/dvrs/${dvr.id}/snapshot?channel=1&_=${bust}`;
  const [failed, setFailed] = useState(false);

  return (
    <div className="overflow-hidden rounded-lg border border-ink-500 bg-white">
      <div className="relative aspect-video cursor-pointer bg-black" onClick={onView}>
        {failed ? (
          <div className="grid h-full place-items-center p-3 text-center text-xs text-rose-400">
            <div>
              <AlertCircle size={20} className="mx-auto mb-1" />
              DVR unreachable
              <div className="mt-1 font-mono text-[10px] text-rose-500">{dvr.ipAddress}</div>
            </div>
          </div>
        ) : (
          <SnapshotImage src={src} token={token} onError={() => setFailed(true)} />
        )}
        <span className={`absolute right-2 top-2 rounded px-2 py-0.5 text-[10px] font-semibold ${
          dvr.brand === 'DAHUA' ? 'bg-orange-100 text-orange-700' :
          dvr.brand === 'HIKVISION' ? 'bg-red-100 text-red-700' :
          'bg-slate-100 text-slate-700'
        }`}>{dvr.brand}</span>
      </div>
      <div className="p-3">
        <div className="flex items-center justify-between">
          <div>
            <div className="text-sm font-semibold text-ink-50">{dvr.name}</div>
            <div className="text-[11px] text-ink-300">
              <span className="font-mono">{dvr.ipAddress}:{dvr.httpPort}</span> · {dvr.channels} ch
            </div>
          </div>
          <div className="flex gap-1">
            <button className="btn-ghost" title="View channels" onClick={onView}>
              <Video size={12} />
            </button>
            <button className="btn-ghost" title="Refresh snapshot"
              onClick={() => { setFailed(false); setBust(Date.now()); }}>
              <RefreshCw size={12} />
            </button>
            {canWrite && (
              <>
                <button className="btn-ghost" title="Edit" onClick={onEdit}><Pencil size={12} /></button>
                <button className="btn-ghost text-rose-500" title="Delete" onClick={onDelete}><Trash2 size={12} /></button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// -------- Auth'd snapshot image (browsers can't put Bearer in <img src>) --------
function SnapshotImage({ src, token, onError }: { src: string; token: string; onError: () => void }) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  useMemo(() => {
    let cancelled = false;
    setBlobUrl(null);
    fetch(src, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.blob(); })
      .then((b) => { if (!cancelled) setBlobUrl(URL.createObjectURL(b)); })
      .catch(() => { if (!cancelled) onError(); });
    return () => { cancelled = true; };
  }, [src]);
  if (!blobUrl) return <div className="grid h-full place-items-center text-xs text-ink-300">Loading…</div>;
  return <img src={blobUrl} alt="DVR snapshot" className="h-full w-full object-cover" />;
}

// -------- Full viewer modal: all channel snapshots + RTSP list + web UI launch --------
function DvrViewer({ dvr, token, onClose }: { dvr: Dvr; token: string; onClose: () => void }) {
  const endpoints = useQuery({
    queryKey: ['dvr-endpoints', dvr.id],
    queryFn: () => api.get<Endpoints>(`/dvrs/${dvr.id}/endpoints`).then((r) => r.data),
  });
  const [bust, setBust] = useState(Date.now());
  const channels = Array.from({ length: dvr.channels }, (_, i) => i + 1);

  function copy(text: string) { navigator.clipboard.writeText(text); }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
      <div className="max-h-[90vh] w-full max-w-5xl overflow-y-auto rounded-xl bg-white p-4 shadow-2xl">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-ink-50">{dvr.name}</h3>
            <p className="text-xs text-ink-300">
              {dvr.store?.code} — {dvr.store?.name} · <span className="font-mono">{dvr.ipAddress}:{dvr.httpPort}</span>
            </p>
          </div>
          <div className="flex gap-2">
            <button className="btn-ghost" onClick={() => setBust(Date.now())}>
              <RefreshCw size={13} />Refresh all
            </button>
            {endpoints.data && (
              <a className="btn-primary" href={endpoints.data.webUrl} target="_blank" rel="noreferrer">
                <ExternalLink size={13} />Open web UI
              </a>
            )}
            <button className="btn-ghost" onClick={onClose}><X size={13} /></button>
          </div>
        </div>

        {/* Channel grid */}
        <div className="grid grid-cols-2 gap-2 md:grid-cols-3 lg:grid-cols-4">
          {channels.map((ch) => (
            <div key={ch} className="overflow-hidden rounded-lg border border-ink-500 bg-black">
              <div className="relative aspect-video">
                <SnapshotImage
                  src={`${api.defaults.baseURL}/dvrs/${dvr.id}/snapshot?channel=${ch}&_=${bust}`}
                  token={token}
                  onError={() => {}}
                />
                <span className="absolute left-2 top-2 rounded bg-black/60 px-2 py-0.5 text-[10px] font-semibold text-white">
                  Ch {ch}
                </span>
              </div>
            </div>
          ))}
        </div>

        {/* RTSP URLs */}
        {endpoints.data && (
          <div className="mt-4">
            <h4 className="mb-2 text-xs font-semibold uppercase tracking-wider text-ink-300">
              RTSP URLs (paste into VLC, iOS RTSP Player, etc)
            </h4>
            <div className="space-y-1">
              {endpoints.data.rtspByChannel.map((r) => (
                <div key={r.channel} className="flex items-center gap-2">
                  <div className="w-14 text-xs text-ink-300">Ch {r.channel}</div>
                  <input className="field flex-1 font-mono text-[11px]" readOnly value={r.url} />
                  <button className="btn-ghost" onClick={() => copy(r.url)}><Copy size={12} /></button>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
