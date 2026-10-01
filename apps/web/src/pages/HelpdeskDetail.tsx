import { useRef, useState } from 'react';
import { useNavigate, useParams, Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { PageHeader } from '@/components/PageHeader';
import { useAuth } from '@/store/auth';
import {
  AlertTriangle, ArrowLeft, Clock, Download, File as FileIcon, Image as ImageIcon,
  Paperclip, Send, Timer, Trash2, Upload, User as UserIcon,
} from 'lucide-react';

const PRIORITY_STYLES: Record<string, string> = {
  P1: 'bg-rose-100 text-rose-700 ring-1 ring-rose-300',
  P2: 'bg-amber-100 text-amber-700 ring-1 ring-amber-300',
  P3: 'bg-sky-100 text-sky-700 ring-1 ring-sky-300',
  P4: 'bg-slate-100 text-slate-600 ring-1 ring-slate-300',
};
const STATUS_STYLES: Record<string, string> = {
  NEW: 'bg-brand-50 text-brand-700 ring-1 ring-brand-200',
  ASSIGNED: 'bg-sky-50 text-sky-700 ring-1 ring-sky-200',
  IN_PROGRESS: 'bg-violet-50 text-violet-700 ring-1 ring-violet-200',
  WAITING_ON_USER: 'bg-amber-50 text-amber-700 ring-1 ring-amber-200',
  RESOLVED: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  CLOSED: 'bg-slate-100 text-slate-500 ring-1 ring-slate-300',
  REOPENED: 'bg-rose-50 text-rose-700 ring-1 ring-rose-200',
};
const LEGAL_NEXT: Record<string, string[]> = {
  NEW:             ['ASSIGNED','IN_PROGRESS','WAITING_ON_USER','RESOLVED','CLOSED'],
  ASSIGNED:        ['IN_PROGRESS','WAITING_ON_USER','RESOLVED','CLOSED'],
  IN_PROGRESS:     ['WAITING_ON_USER','RESOLVED','CLOSED','ASSIGNED'],
  WAITING_ON_USER: ['IN_PROGRESS','ASSIGNED','RESOLVED','CLOSED'],
  RESOLVED:        ['REOPENED','CLOSED'],
  CLOSED:          ['REOPENED'],
  REOPENED:        ['ASSIGNED','IN_PROGRESS','WAITING_ON_USER','RESOLVED'],
};

function timeAgo(iso?: string) {
  if (!iso) return '—';
  const ms = Date.now() - new Date(iso).getTime();
  const abs = Math.abs(ms);
  const past = ms >= 0;
  const mins = Math.floor(abs / 60_000);
  if (mins < 60)   return `${past?'':'in '}${mins}m${past?' ago':''}`;
  const hours = Math.floor(mins / 60);
  if (hours < 48)  return `${past?'':'in '}${hours}h${past?' ago':''}`;
  const days  = Math.floor(hours / 24);
  return `${past?'':'in '}${days}d${past?' ago':''}`;
}

export function HelpdeskDetail() {
  const { id } = useParams();
  const nav = useNavigate();
  const qc = useQueryClient();
  const token = useAuth((s) => s.token);
  const currentUser = useAuth((s) => s.user);
  const hasPerm = useAuth((s) => s.hasPermission);
  const canAssign = hasPerm('tickets:assign');

  const ticket = useQuery({
    queryKey: ['ticket', id],
    queryFn: () => api.get(`/helpdesk/tickets/${id}`).then((r) => r.data),
    refetchInterval: 30_000,
  });
  const categories = useQuery({ queryKey: ['hd-cats'], queryFn: () => api.get('/helpdesk/categories').then((r) => r.data) });
  const users = useQuery({ queryKey: ['hd-users'], queryFn: () => api.get('/users').then((r) => r.data).catch(() => []) });

  const patch = useMutation({
    mutationFn: (body: any) => api.patch(`/helpdesk/tickets/${id}`, body).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ticket', id] }),
  });

  const [reply, setReply] = useState('');
  const [isInternal, setIsInternal] = useState(false);
  const comment = useMutation({
    mutationFn: () => api.post(`/helpdesk/tickets/${id}/comments`, { body: reply, isInternal }).then((r) => r.data),
    onSuccess: () => { setReply(''); qc.invalidateQueries({ queryKey: ['ticket', id] }); },
  });

  // --- Attachments ---
  const fileInput = useRef<HTMLInputElement | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const upload = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append('file', file);
      const r = await api.post(`/helpdesk/tickets/${id}/attachments`, fd, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      return r.data;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ticket', id] }),
    onError: (e: any) => setUploadErr(e?.response?.data?.message ?? 'Upload failed'),
  });
  const deleteAttachment = useMutation({
    mutationFn: (attId: string) => api.delete(`/helpdesk/attachments/${attId}`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['ticket', id] }),
  });
  function pickFiles() { fileInput.current?.click(); }
  function handleFiles(files: FileList | null) {
    if (!files) return;
    setUploadErr(null);
    for (const f of Array.from(files)) upload.mutate(f);
  }
  function attachmentDownloadUrl(attId: string) {
    // Server issues a 302 redirect to a signed MinIO URL; we open in a new tab
    // and include the bearer via a temporary <a> that triggers a fetch, but
    // easiest: use fetch + blob so auth header goes with the request.
    fetch(`${api.defaults.baseURL}/helpdesk/attachments/${attId}/download`, {
      headers: { Authorization: `Bearer ${token}` }, redirect: 'follow',
    }).then((r) => r.blob()).then((b) => {
      const u = URL.createObjectURL(b);
      const a = document.createElement('a');
      a.href = u; a.click(); URL.revokeObjectURL(u);
    });
  }

  if (!ticket.data) return <div className="p-6 text-sm text-ink-300">Loading…</div>;
  const t = ticket.data;
  const legalStatuses = LEGAL_NEXT[t.status] ?? [];

  return (
    <>
      <PageHeader
        title={`${t.code} · ${t.subject}`}
        subtitle={`Opened ${new Date(t.createdAt).toLocaleString()} by ${t.reporter?.fullName ?? '—'}`}
        actions={<button className="btn-ghost" onClick={() => nav('/helpdesk')}><ArrowLeft size={13}/>Back to queue</button>}
      />

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[1fr_320px]">
        {/* --- LEFT: description + timeline --- */}
        <div className="space-y-4">
          <section className="card p-4">
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${PRIORITY_STYLES[t.priority]}`}>{t.priority}</span>
              <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${STATUS_STYLES[t.status]}`}>{t.status.replaceAll('_',' ')}</span>
              <span className="text-xs text-ink-300">{t.category?.name}</span>
              {(t.slaBreachedResponse || t.slaBreachedResolve) && (
                <span className="inline-flex items-center gap-1 rounded bg-rose-50 px-2 py-0.5 text-[11px] text-rose-700 ring-1 ring-rose-300">
                  <AlertTriangle size={11}/>SLA breached
                </span>
              )}
            </div>
            <h2 className="text-lg font-semibold text-ink-50">{t.subject}</h2>
            <div className="prose prose-sm mt-3 max-w-none whitespace-pre-wrap text-ink-100">{t.description}</div>
          </section>

          {/* Comments */}
          <section className="card p-4">
            <h3 className="mb-3 text-sm font-semibold text-slate-700">Conversation</h3>
            <div className="space-y-3">
              {t.comments?.length ? t.comments.map((c: any) => (
                <div key={c.id} className={`rounded-lg border p-3 ${c.isInternal ? 'border-amber-200 bg-amber-50/40' : 'border-ink-500/40 bg-slate-50/50'}`}>
                  <div className="mb-1 flex items-center justify-between text-xs text-ink-300">
                    <span className="font-medium text-ink-100">{c.author?.fullName}</span>
                    <span>{new Date(c.createdAt).toLocaleString()}
                      {c.isInternal && <span className="ml-2 rounded bg-amber-100 px-1.5 text-[10px] text-amber-800">Internal note</span>}
                    </span>
                  </div>
                  <div className="whitespace-pre-wrap text-sm text-ink-100">{c.body}</div>
                </div>
              )) : <div className="text-xs text-ink-300">No replies yet.</div>}
            </div>

            {/* Compose */}
            <div className="mt-4 border-t border-ink-500/30 pt-3">
              <textarea className="field text-sm" rows={3}
                placeholder="Type a reply… Markdown works." value={reply}
                onChange={(e) => setReply(e.target.value)} />
              <div className="mt-2 flex items-center justify-between">
                {canAssign ? (
                  <label className="flex items-center gap-1 text-xs text-ink-200">
                    <input type="checkbox" checked={isInternal} onChange={(e) => setIsInternal(e.target.checked)} />
                    Internal note (hidden from reporter)
                  </label>
                ) : <div />}
                <button className="btn-primary" disabled={!reply.trim() || comment.isPending}
                  onClick={() => comment.mutate()}>
                  <Send size={13}/>{comment.isPending ? 'Posting…' : 'Post reply'}
                </button>
              </div>
            </div>
          </section>

          {/* Attachments */}
          <section className="card p-4">
            <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700">
              <Paperclip size={14}/>Attachments
              <span className="text-xs font-normal text-ink-300">({t.attachments?.length ?? 0})</span>
            </h3>

            {/* Drag-drop zone */}
            <div
              className={`mb-3 flex flex-col items-center justify-center rounded-lg border-2 border-dashed p-4 text-center transition-colors ${
                dragOver ? 'border-brand-500 bg-brand-50' : 'border-ink-500/40 bg-slate-50/40'
              }`}
              onDragOver={(e) => { e.preventDefault(); setDragOver(true); }}
              onDragLeave={() => setDragOver(false)}
              onDrop={(e) => {
                e.preventDefault(); setDragOver(false);
                handleFiles(e.dataTransfer.files);
              }}
            >
              <Upload size={20} className="mb-1 text-ink-300" />
              <div className="text-sm text-ink-100">
                Drop files here or{' '}
                <button className="text-brand-700 underline" onClick={pickFiles}>browse</button>
              </div>
              <div className="text-[11px] text-ink-300">Screenshots, logs, docs — up to 25 MB each</div>
              <input ref={fileInput} type="file" multiple className="hidden"
                onChange={(e) => handleFiles(e.target.files)} />
              {upload.isPending && <div className="mt-2 text-xs text-brand-600">Uploading…</div>}
              {uploadErr && <div className="mt-2 text-xs text-rose-600">{uploadErr}</div>}
            </div>

            {/* List */}
            {t.attachments?.length ? (
              <ul className="space-y-2">
                {t.attachments.map((a: any) => {
                  const isImage = a.contentType?.startsWith('image/');
                  const canDelete = canAssign || a.uploadedById === currentUser?.id;
                  return (
                    <li key={a.id} className="flex items-center gap-3 rounded border border-ink-500/40 bg-white p-2">
                      <div className="grid h-9 w-9 place-items-center rounded bg-slate-100 text-ink-300">
                        {isImage ? <ImageIcon size={16}/> : <FileIcon size={16}/>}
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="truncate text-sm text-ink-100">{a.filename}</div>
                        <div className="text-[11px] text-ink-300">
                          {a.uploadedBy?.fullName} · {new Date(a.createdAt).toLocaleString()} ·{' '}
                          {(a.sizeBytes / 1024).toFixed(0)} KB
                        </div>
                      </div>
                      <button className="btn-ghost" title="Download"
                        onClick={() => attachmentDownloadUrl(a.id)}>
                        <Download size={12}/>
                      </button>
                      {canDelete && (
                        <button className="btn-ghost text-rose-500" title="Delete"
                          disabled={deleteAttachment.isPending}
                          onClick={() => {
                            if (confirm(`Delete ${a.filename}?`)) deleteAttachment.mutate(a.id);
                          }}>
                          <Trash2 size={12}/>
                        </button>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="text-xs text-ink-300">No attachments yet.</div>
            )}
          </section>

          {/* Activity timeline */}
          <section className="card p-4">
            <h3 className="mb-3 text-sm font-semibold text-slate-700">Activity</h3>
            <ul className="space-y-2">
              {t.events?.map((e: any) => (
                <li key={e.id} className="flex items-start gap-2 text-xs">
                  <Clock size={12} className="mt-0.5 text-ink-300" />
                  <div className="flex-1">
                    <span className="font-medium text-ink-100">{e.actor?.fullName ?? 'System'}</span>
                    <span className="text-ink-300"> · {e.eventType.replaceAll('_',' ').toLowerCase()}</span>
                    {e.fromValue && e.toValue && (
                      <span className="text-ink-300"> ({e.fromValue} → {e.toValue})</span>
                    )}
                    {e.notes && <span className="text-ink-300"> — {e.notes}</span>}
                  </div>
                  <span className="text-ink-300">{new Date(e.occurredAt).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          </section>
        </div>

        {/* --- RIGHT: actions + meta --- */}
        <div className="space-y-4">
          <section className="card p-4">
            <h3 className="mb-3 text-sm font-semibold text-slate-700">Actions</h3>

            {canAssign && legalStatuses.length > 0 && (
              <div className="mb-3">
                <label className="label">Change status</label>
                <div className="flex flex-wrap gap-1">
                  {legalStatuses.map((s) => (
                    <button key={s}
                      className={`rounded px-2 py-1 text-[11px] font-medium ring-1 ${STATUS_STYLES[s]} hover:opacity-80`}
                      disabled={patch.isPending}
                      onClick={() => patch.mutate({ status: s })}>
                      → {s.replaceAll('_',' ')}
                    </button>
                  ))}
                </div>
              </div>
            )}

            {canAssign && (
              <>
                <div className="mb-3">
                  <label className="label">Assignee</label>
                  <select className="field" value={t.assignedToId ?? ''}
                    onChange={(e) => patch.mutate({ assignedToId: e.target.value || null })}>
                    <option value="">Unassigned</option>
                    {users.data?.map((u: any) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
                  </select>
                </div>
                <div className="mb-3">
                  <label className="label">Priority</label>
                  <select className="field" value={t.priority}
                    onChange={(e) => patch.mutate({ priority: e.target.value })}>
                    <option value="P1">P1 — Critical</option>
                    <option value="P2">P2 — High</option>
                    <option value="P3">P3 — Standard</option>
                    <option value="P4">P4 — Low</option>
                  </select>
                </div>
                <div className="mb-3">
                  <label className="label">Category</label>
                  <select className="field" value={t.categoryId}
                    onChange={(e) => patch.mutate({ categoryId: e.target.value })}>
                    {categories.data?.map((c: any) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
                  </select>
                </div>
              </>
            )}
          </section>

          <section className="card p-4">
            <h3 className="mb-3 text-sm font-semibold text-slate-700">Details</h3>
            <dl className="space-y-2 text-xs">
              <div><dt className="text-ink-300">Reporter</dt><dd><UserIcon size={11} className="mr-1 inline text-ink-300"/>{t.reporter?.fullName}</dd></div>
              <div><dt className="text-ink-300">Store</dt><dd>{t.store ? `${t.store.code} — ${t.store.name}` : t.department ? `HQ / ${t.department.name}` : '—'}</dd></div>
              {t.asset && (
                <div><dt className="text-ink-300">Asset</dt>
                  <dd><Link className="font-mono text-brand-700 hover:underline" to={`/assets/${t.asset.id}`}>{t.asset.assetTag}</Link>
                      {t.asset.sku?.name && <span className="text-ink-300"> — {t.asset.sku.name}</span>}</dd>
                </div>
              )}
              <div><dt className="text-ink-300">Source</dt><dd>{t.source}</dd></div>
              <div><dt className="text-ink-300">Created</dt><dd>{new Date(t.createdAt).toLocaleString()}</dd></div>
              {t.resolvedAt && <div><dt className="text-ink-300">Resolved</dt><dd>{new Date(t.resolvedAt).toLocaleString()}</dd></div>}
              {t.closedAt && <div><dt className="text-ink-300">Closed</dt><dd>{new Date(t.closedAt).toLocaleString()}</dd></div>}
            </dl>
          </section>

          {(t.slaFirstResponseBy || t.slaResolveBy) && (
            <section className="card p-4">
              <h3 className="mb-3 flex items-center gap-2 text-sm font-semibold text-slate-700"><Timer size={14}/>SLA</h3>
              <dl className="space-y-2 text-xs">
                {t.slaFirstResponseBy && (
                  <div>
                    <dt className="text-ink-300">First response by</dt>
                    <dd className={t.slaBreachedResponse ? 'text-rose-600' : 'text-ink-100'}>
                      {new Date(t.slaFirstResponseBy).toLocaleString()} <span className="text-ink-300">({timeAgo(t.slaFirstResponseBy)})</span>
                    </dd>
                  </div>
                )}
                {t.slaResolveBy && (
                  <div>
                    <dt className="text-ink-300">Resolve by</dt>
                    <dd className={t.slaBreachedResolve ? 'text-rose-600' : 'text-ink-100'}>
                      {new Date(t.slaResolveBy).toLocaleString()} <span className="text-ink-300">({timeAgo(t.slaResolveBy)})</span>
                    </dd>
                  </div>
                )}
                {t.firstResponseAt && (
                  <div><dt className="text-ink-300">First response at</dt><dd>{new Date(t.firstResponseAt).toLocaleString()}</dd></div>
                )}
              </dl>
            </section>
          )}
        </div>
      </div>
    </>
  );
}
