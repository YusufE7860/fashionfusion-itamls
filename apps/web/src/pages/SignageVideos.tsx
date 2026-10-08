import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { PageHeader } from '@/components/PageHeader';
import { useAuth } from '@/store/auth';
import { Trash2, Upload } from 'lucide-react';

export function SignageVideos() {
  const qc = useQueryClient();
  const hasPerm = useAuth((s) => s.hasPermission);
  const canWrite = hasPerm('stores:write');
  const fileInput = useRef<HTMLInputElement | null>(null);

  const items = useQuery({ queryKey: ['signage-videos'], queryFn: () => api.get('/signage/videos').then((r) => r.data) });
  const [progress, setProgress] = useState<{ name: string; pct: number } | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [nextOrientation, setNextOrientation] = useState<'LANDSCAPE' | 'PORTRAIT' | 'ANY'>('LANDSCAPE');
  const [nextEntity, setNextEntity] = useState<'FASHION_FUSION' | 'EVLV' | 'BOTH'>('FASHION_FUSION');
  const [filterEntity, setFilterEntity] = useState<'ALL' | 'FASHION_FUSION' | 'EVLV' | 'BOTH'>('ALL');

  const upload = useMutation({
    mutationFn: async (file: File) => {
      setErr(null); setProgress({ name: file.name, pct: 0 });
      const { data: pre } = await api.post('/signage/videos/upload-url', { filename: file.name });
      // Direct PUT to MinIO via presigned URL
      await new Promise<void>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('PUT', pre.uploadUrl);
        xhr.upload.onprogress = (e) => {
          if (e.lengthComputable) setProgress({ name: file.name, pct: Math.round((e.loaded / e.total) * 100) });
        };
        xhr.onload = () => (xhr.status >= 200 && xhr.status < 300) ? resolve() : reject(new Error(`Upload failed: ${xhr.status}`));
        xhr.onerror = () => reject(new Error('Upload network error'));
        xhr.send(file);
      });
      await api.post('/signage/videos', {
        filename: file.name, storageKey: pre.storageKey,
        sizeBytes: file.size,
        orientation: nextOrientation,
        entity: nextEntity,
      });
    },
    onSuccess: () => { setProgress(null); qc.invalidateQueries({ queryKey: ['signage-videos'] }); },
    onError: (e: any) => { setProgress(null); setErr(e.message ?? 'Upload failed'); },
  });

  const update = useMutation({
    mutationFn: ({ id, body }: any) => api.patch(`/signage/videos/${id}`, body).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['signage-videos'] }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/signage/videos/${id}`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['signage-videos'] }),
  });

  return (
    <>
      <PageHeader
        title="Signage — Videos"
        subtitle="Upload once, assign to playlists"
        actions={
          <>
            <label className="flex items-center gap-1 text-xs text-ink-200">
              Filter:
              <select className="field !py-1 text-xs" value={filterEntity}
                onChange={(e) => setFilterEntity(e.target.value as any)}>
                <option value="ALL">All brands</option>
                <option value="FASHION_FUSION">Fashion Fusion</option>
                <option value="EVLV">Evolve</option>
                <option value="BOTH">Shared (Both)</option>
              </select>
            </label>
            {canWrite && (
              <>
                <label className="flex items-center gap-1 text-xs text-ink-200">
                  Upload as:
                  <select className="field !py-1 text-xs" value={nextEntity}
                    onChange={(e) => setNextEntity(e.target.value as any)}>
                    <option value="FASHION_FUSION">Fashion Fusion</option>
                    <option value="EVLV">Evolve</option>
                    <option value="BOTH">Both brands</option>
                  </select>
                </label>
                <label className="flex items-center gap-1 text-xs text-ink-200">
                  <select className="field !py-1 text-xs" value={nextOrientation}
                    onChange={(e) => setNextOrientation(e.target.value as any)}>
                    <option value="LANDSCAPE">Landscape</option>
                    <option value="PORTRAIT">Portrait</option>
                    <option value="ANY">Any orientation</option>
                  </select>
                </label>
                <input ref={fileInput} type="file" className="hidden" accept="video/*"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) upload.mutate(f); e.target.value = ''; }} />
                <button className="btn-primary" onClick={() => fileInput.current?.click()}>
                  <Upload size={13}/>Upload video
                </button>
              </>
            )}
          </>
        }
      />

      {progress && (
        <section className="card mb-4 p-3">
          <div className="mb-1 text-xs text-ink-200">Uploading {progress.name} — {progress.pct}%</div>
          <div className="h-2 overflow-hidden rounded bg-slate-100">
            <div className="h-full bg-brand-500 transition-all" style={{ width: `${progress.pct}%` }} />
          </div>
        </section>
      )}
      {err && <div className="mb-4 rounded bg-rose-50 p-3 text-xs text-rose-700">{err}</div>}

      <section className="card p-4">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="th text-left">File</th>
              <th className="th text-left">Brand</th>
              <th className="th text-left">Orientation</th>
              <th className="th text-right">Size</th>
              <th className="th text-left">Uploaded</th>
              <th className="th text-left">By</th>
              <th className="th text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.data?.filter((v: any) => filterEntity === 'ALL' || (v.entity ?? 'BOTH') === filterEntity).length === 0 && (
              <tr><td colSpan={7} className="py-6 text-center text-xs text-ink-300">No videos for this filter.</td></tr>
            )}
            {items.data?.filter((v: any) => filterEntity === 'ALL' || (v.entity ?? 'BOTH') === filterEntity).map((v: any) => (
              <tr key={v.id} className="border-b border-ink-500/10">
                <td className="py-2 font-mono text-xs">{v.filename}</td>
                <td className="py-2 text-xs">
                  {canWrite ? (
                    <select className="field !py-0.5 text-xs" value={v.entity ?? 'BOTH'}
                      onChange={(e) => update.mutate({ id: v.id, body: { entity: e.target.value } })}>
                      <option value="FASHION_FUSION">Fashion Fusion</option>
                      <option value="EVLV">Evolve</option>
                      <option value="BOTH">Both</option>
                    </select>
                  ) : (v.entity ?? 'BOTH')}
                </td>
                <td className="py-2 text-xs">
                  {canWrite ? (
                    <select className="field !py-0.5 text-xs" value={v.orientation ?? 'ANY'}
                      onChange={(e) => update.mutate({ id: v.id, body: { orientation: e.target.value } })}>
                      <option value="LANDSCAPE">Landscape</option>
                      <option value="PORTRAIT">Portrait</option>
                      <option value="ANY">Any</option>
                    </select>
                  ) : (v.orientation ?? 'ANY')}
                </td>
                <td className="py-2 text-right text-xs">
                  {v.sizeBytes ? `${(Number(v.sizeBytes) / (1024*1024)).toFixed(1)} MB` : '—'}
                </td>
                <td className="py-2 text-xs text-ink-300">{new Date(v.createdAt).toLocaleString()}</td>
                <td className="py-2 text-xs">{v.uploadedBy?.fullName ?? '—'}</td>
                <td className="py-2 text-right">
                  {canWrite && (
                    <button className="btn-ghost text-rose-500"
                      onClick={() => { if (confirm(`Delete ${v.filename}?`)) remove.mutate(v.id); }}>
                      <Trash2 size={12}/>
                    </button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>
    </>
  );
}
