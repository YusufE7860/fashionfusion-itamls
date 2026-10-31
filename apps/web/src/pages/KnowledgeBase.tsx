import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { PageHeader } from '@/components/PageHeader';
import { useAuth } from '@/store/auth';
import { Search, Plus, ThumbsUp, ThumbsDown, Pencil, Trash2, X } from 'lucide-react';

/**
 * Minimal KB index + article view. New-ticket form hits
 * /helpdesk/kb/deflection/suggest separately — this page is for IT to
 * manage articles and for everyone else to browse them.
 */
export function KnowledgeBase() {
  const qc = useQueryClient();
  const hasPerm = useAuth((s) => s.hasPermission);
  const canWrite = hasPerm('kb:write');

  const [q, setQ] = useState('');
  const [slug, setSlug] = useState<string | null>(null);
  const [showNew, setShowNew] = useState(false);

  const list = useQuery({
    queryKey: ['kb-list', q],
    queryFn: () => api.get('/helpdesk/kb', { params: { q } }).then((r) => r.data),
  });
  const article = useQuery({
    queryKey: ['kb-article', slug],
    queryFn: () => api.get(`/helpdesk/kb/${slug}`).then((r) => r.data),
    enabled: !!slug,
  });

  const create = useMutation({
    mutationFn: (body: any) => api.post('/helpdesk/kb', body).then((r) => r.data),
    onSuccess: (a: any) => { qc.invalidateQueries({ queryKey: ['kb-list'] }); setSlug(a.slug); setShowNew(false); },
  });
  const update = useMutation({
    mutationFn: ({ id, body }: any) => api.patch(`/helpdesk/kb/${id}`, body).then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['kb-list'] }); qc.invalidateQueries({ queryKey: ['kb-article', slug] }); },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/helpdesk/kb/${id}`).then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['kb-list'] }); setSlug(null); },
  });
  const vote = useMutation({
    mutationFn: ({ id, helpful }: any) => api.post(`/helpdesk/kb/${id}/helpful`, { helpful }).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['kb-article', slug] }),
  });

  return (
    <>
      <PageHeader
        title="Knowledge base"
        subtitle="Self-service answers so fewer tickets get logged in the first place"
        actions={canWrite && (
          <button className="btn-primary" onClick={() => setShowNew(true)}>
            <Plus size={13}/>New article
          </button>
        )}
      />

      <div className="grid grid-cols-1 gap-4 md:grid-cols-[280px_1fr]">
        {/* Mobile: article list collapses when an article is picked, so the
            reader isn't fighting with the sidebar on a 375px screen. */}
        <section className={`card p-3 ${slug ? 'hidden md:block' : ''}`}>
          <div className="relative mb-3">
            <Search size={13} className="absolute left-2 top-1/2 -translate-y-1/2 text-ink-300"/>
            <input className="field pl-7 text-xs" placeholder="Search title / tags / body…"
              value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <ul className="space-y-1 text-sm">
            {list.data?.length === 0 && <li className="text-xs text-ink-300">No articles yet.</li>}
            {list.data?.map((a: any) => (
              <li key={a.id}>
                <button
                  className={`w-full rounded px-2 py-1 text-left text-xs ${slug === a.slug ? 'bg-brand-50 text-brand-700' : 'hover:bg-slate-50'}`}
                  onClick={() => setSlug(a.slug)}>
                  <div className="font-semibold">{a.title}</div>
                  <div className="text-[10px] text-ink-300">
                    {a.category?.name ?? '—'} · {a.views}👁 · {a.helpfulYes}👍 {a.helpfulNo}👎
                  </div>
                </button>
              </li>
            ))}
          </ul>
        </section>

        <section className="card p-4">
          {slug && (
            <button className="btn-ghost mb-3 md:hidden" onClick={() => setSlug(null)}>
              ← Back to list
            </button>
          )}
          {showNew ? (
            <ArticleForm onCancel={() => setShowNew(false)} onSave={(body) => create.mutate(body)} />
          ) : !slug ? (
            <div className="p-6 text-center text-sm text-ink-300">Pick an article on the left, or create one.</div>
          ) : article.data ? (
            <ArticleView
              a={article.data}
              canWrite={canWrite}
              onEdit={(body) => update.mutate({ id: article.data.id, body })}
              onDelete={() => { if (confirm(`Delete "${article.data.title}"?`)) remove.mutate(article.data.id); }}
              onVote={(helpful) => vote.mutate({ id: article.data.id, helpful })} />
          ) : <div className="p-6 text-xs text-ink-300">Loading…</div>}
        </section>
      </div>
    </>
  );
}

function ArticleForm({ initial, onCancel, onSave }: any) {
  const [form, setForm] = useState({
    title: initial?.title ?? '', body: initial?.body ?? '', tags: initial?.tags ?? '',
  });
  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <h3 className="text-sm font-semibold">{initial ? 'Edit article' : 'New article'}</h3>
        <button className="btn-ghost" onClick={onCancel}><X size={13}/></button>
      </div>
      <div className="space-y-2">
        <input className="field" placeholder="Title"
          value={form.title} onChange={(e) => setForm({ ...form, title: e.target.value })}/>
        <input className="field" placeholder="Tags (comma-separated)"
          value={form.tags} onChange={(e) => setForm({ ...form, tags: e.target.value })}/>
        <textarea className="field font-mono text-xs" rows={14}
          placeholder="Body (markdown)"
          value={form.body} onChange={(e) => setForm({ ...form, body: e.target.value })}/>
      </div>
      <button className="btn-primary mt-3"
        disabled={!form.title.trim() || !form.body.trim()}
        onClick={() => onSave(form)}>Save</button>
    </div>
  );
}

function ArticleView({ a, canWrite, onEdit, onDelete, onVote }: any) {
  const [editing, setEditing] = useState(false);
  if (editing) return <ArticleForm initial={a} onCancel={() => setEditing(false)}
    onSave={(body: any) => { onEdit(body); setEditing(false); }} />;
  return (
    <div>
      <div className="mb-3 flex items-start justify-between">
        <div>
          <h2 className="text-lg font-semibold">{a.title}</h2>
          <div className="text-xs text-ink-300">
            Updated {new Date(a.updatedAt).toLocaleDateString()} · {a.views} views · tags: {a.tags || '—'}
          </div>
        </div>
        {canWrite && (
          <div className="flex gap-1">
            <button className="btn-ghost" onClick={() => setEditing(true)}><Pencil size={11}/></button>
            <button className="btn-ghost text-rose-600" onClick={onDelete}><Trash2 size={11}/></button>
          </div>
        )}
      </div>
      <article className="prose prose-sm max-w-none whitespace-pre-wrap text-sm">{a.body}</article>
      <div className="mt-4 flex items-center gap-2 border-t pt-3 text-xs text-ink-300">
        <span>Was this helpful?</span>
        <button className="btn-ghost" onClick={() => onVote(true)}><ThumbsUp size={11}/>{a.helpfulYes}</button>
        <button className="btn-ghost" onClick={() => onVote(false)}><ThumbsDown size={11}/>{a.helpfulNo}</button>
      </div>
    </div>
  );
}
