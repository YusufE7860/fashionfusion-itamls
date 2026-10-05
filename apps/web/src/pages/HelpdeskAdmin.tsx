import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { PageHeader } from '@/components/PageHeader';
import { useAuth } from '@/store/auth';
import { CheckCircle2, Mail, Plus, Save, Trash2, X, XCircle, Webhook, Zap, FileText, MessageSquare } from 'lucide-react';

export function HelpdeskAdmin() {
  const qc = useQueryClient();
  const hasPerm = useAuth((s) => s.hasPermission);
  const canManage = hasPerm('tickets:manage:categories');

  const cats = useQuery({
    queryKey: ['hd-cats-admin'],
    queryFn: () => api.get('/helpdesk/categories', { params: { includeInactive: true } }).then((r) => r.data),
  });
  const slas = useQuery({ queryKey: ['hd-slas'], queryFn: () => api.get('/helpdesk/sla-policies').then((r) => r.data) });
  const users = useQuery({ queryKey: ['hd-users'], queryFn: () => api.get('/users').then((r) => r.data).catch(() => []) });

  const [editing, setEditing] = useState<any | null>(null);
  const [creating, setCreating] = useState(false);
  const emptyCat = { code: '', name: '', defaultPriority: 'P3', defaultAssigneeId: '', slaPolicyId: '', sortOrder: 100, isActive: true, issueTemplate: '', description: '' };
  const [cat, setCat] = useState<any>(emptyCat);

  const save = useMutation({
    mutationFn: () => {
      const body = { ...cat, defaultAssigneeId: cat.defaultAssigneeId || null, slaPolicyId: cat.slaPolicyId || null };
      return editing?.id
        ? api.patch(`/helpdesk/categories/${editing.id}`, body).then((r) => r.data)
        : api.post('/helpdesk/categories', body).then((r) => r.data);
    },
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['hd-cats-admin'] }); qc.invalidateQueries({ queryKey: ['hd-cats'] }); setCreating(false); setEditing(null); setCat(emptyCat); },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/helpdesk/categories/${id}`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hd-cats-admin'] }),
  });

  return (
    <>
      <PageHeader
        title="Helpdesk configuration"
        subtitle="Categories and SLA policies"
        actions={canManage && (
          <button className="btn-primary" onClick={() => { setCreating(true); setEditing(null); setCat(emptyCat); }}>
            <Plus size={13}/>New category
          </button>
        )}
      />

      {(creating || editing) && canManage && (
        <section className="card mb-4 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-700">{editing ? `Edit ${editing.code}` : 'New category'}</h3>
            <button className="btn-ghost" onClick={() => { setCreating(false); setEditing(null); setCat(emptyCat); }}><X size={13}/></button>
          </div>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <div>
              <label className="label">Code {editing && <span className="text-ink-300">(fixed)</span>}</label>
              <input className="field font-mono" disabled={!!editing} value={cat.code}
                onChange={(e) => setCat({ ...cat, code: e.target.value.toUpperCase() })} />
            </div>
            <div className="md:col-span-2">
              <label className="label">Name *</label>
              <input className="field" value={cat.name} onChange={(e) => setCat({ ...cat, name: e.target.value })} />
            </div>
            <div>
              <label className="label">Default priority</label>
              <select className="field" value={cat.defaultPriority}
                onChange={(e) => setCat({ ...cat, defaultPriority: e.target.value })}>
                <option>P1</option><option>P2</option><option>P3</option><option>P4</option>
              </select>
            </div>
            <div>
              <label className="label">Auto-assign to</label>
              <select className="field" value={cat.defaultAssigneeId}
                onChange={(e) => setCat({ ...cat, defaultAssigneeId: e.target.value })}>
                <option value="">— nobody —</option>
                {users.data?.map((u: any) => <option key={u.id} value={u.id}>{u.fullName}</option>)}
              </select>
            </div>
            <div>
              <label className="label">SLA policy</label>
              <select className="field" value={cat.slaPolicyId}
                onChange={(e) => setCat({ ...cat, slaPolicyId: e.target.value })}>
                <option value="">— use default —</option>
                {slas.data?.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div>
              <label className="label">Sort order</label>
              <input type="number" className="field" value={cat.sortOrder}
                onChange={(e) => setCat({ ...cat, sortOrder: +e.target.value })} />
            </div>
            <div className="flex items-end">
              <label className="flex items-center gap-1 text-sm">
                <input type="checkbox" checked={cat.isActive}
                  onChange={(e) => setCat({ ...cat, isActive: e.target.checked })} />
                Active
              </label>
            </div>
            <div className="md:col-span-3">
              <label className="label">Short description (shown on the picker tile)</label>
              <input className="field" value={cat.description || ''}
                onChange={(e) => setCat({ ...cat, description: e.target.value })}
                placeholder="e.g. POS, printer, cash drawer problems" />
            </div>
            <div className="md:col-span-3">
              <label className="label flex items-center gap-1"><FileText size={12}/>Issue template (auto-filled into the description field)</label>
              <textarea className="field font-mono text-xs" rows={5}
                placeholder={`What's happening:\nWhen did it start:\nWhat have you tried:\nError messages:`}
                value={cat.issueTemplate || ''}
                onChange={(e) => setCat({ ...cat, issueTemplate: e.target.value })} />
              <p className="mt-1 text-[11px] text-ink-300">
                When a reporter picks this category, this text is pre-filled so they know what info to supply.
              </p>
            </div>
          </div>
          <div className="mt-3">
            <button className="btn-primary" disabled={!cat.name.trim() || save.isPending} onClick={() => save.mutate()}>
              <Save size={12}/>{save.isPending ? 'Saving…' : editing ? 'Save changes' : 'Create category'}
            </button>
          </div>
        </section>
      )}

      <section className="card mb-4 p-4">
        <h3 className="mb-3 text-sm font-semibold text-slate-700">Categories</h3>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="th text-left">Code</th>
                <th className="th text-left">Name</th>
                <th className="th text-left">Default P</th>
                <th className="th text-left">Auto-assign</th>
                <th className="th text-left">SLA</th>
                <th className="th text-right">Sort</th>
                <th className="th text-left">Active</th>
                <th className="th text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {cats.data?.map((c: any) => (
                <tr key={c.id} className="border-b border-ink-500/10">
                  <td className="py-2 font-mono">{c.code}</td>
                  <td className="py-2">{c.name}</td>
                  <td className="py-2">{c.defaultPriority}</td>
                  <td className="py-2 text-xs">{c.defaultAssignee?.fullName ?? '—'}</td>
                  <td className="py-2 text-xs">{c.slaPolicy?.name ?? 'Default'}</td>
                  <td className="py-2 text-right">{c.sortOrder}</td>
                  <td className="py-2 text-xs">{c.isActive ? '✓' : '—'}</td>
                  <td className="py-2 text-right">
                    {canManage && (
                      <div className="flex justify-end gap-1">
                        <button className="btn-ghost" onClick={() => { setEditing(c); setCreating(false); setCat({ ...c, defaultAssigneeId: c.defaultAssigneeId ?? '', slaPolicyId: c.slaPolicyId ?? '' }); }}>Edit</button>
                        <button className="btn-ghost text-rose-500"
                          onClick={() => { if (confirm(`Delete ${c.name}? Categories with tickets get marked inactive instead of hard-deleted.`)) remove.mutate(c.id); }}>
                          <Trash2 size={12}/>
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <EmailIngestPanel canManage={canManage} />
      <CannedResponsesPanel canManage={canManage} categories={cats.data ?? []} />
      <WebhooksPanel />
      <OpsApiPanel />

      <section className="card p-4">
        <h3 className="mb-3 text-sm font-semibold text-slate-700">SLA policies</h3>
        <p className="mb-3 text-[11px] text-ink-300">
          Response = time from ticket creation to the first tech reply.
          Resolve  = time from ticket creation to status RESOLVED.
          Values are in minutes.
        </p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="th text-left">Name</th>
                <th className="th text-right">P1 R/Fix</th>
                <th className="th text-right">P2 R/Fix</th>
                <th className="th text-right">P3 R/Fix</th>
                <th className="th text-right">P4 R/Fix</th>
                <th className="th text-left">Default</th>
              </tr>
            </thead>
            <tbody>
              {slas.data?.map((s: any) => (
                <tr key={s.id} className="border-b border-ink-500/10">
                  <td className="py-2 font-medium">{s.name}</td>
                  <td className="py-2 text-right text-xs">{s.p1FirstResponseMinutes} / {s.p1ResolveMinutes}</td>
                  <td className="py-2 text-right text-xs">{s.p2FirstResponseMinutes} / {s.p2ResolveMinutes}</td>
                  <td className="py-2 text-right text-xs">{s.p3FirstResponseMinutes} / {s.p3ResolveMinutes}</td>
                  <td className="py-2 text-right text-xs">{s.p4FirstResponseMinutes} / {s.p4ResolveMinutes}</td>
                  <td className="py-2 text-xs">{s.isDefault ? '✓' : ''}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}

// ---------------- Email ingest panel ----------------
function EmailIngestPanel({ canManage }: { canManage: boolean }) {
  const qc = useQueryClient();
  const status = useQuery({
    queryKey: ['hd-email-status'],
    queryFn: () => api.get('/helpdesk/email/status').then((r) => r.data),
    refetchInterval: 30_000,
  });
  const poll = useMutation({
    mutationFn: () => api.post('/helpdesk/email/poll-now').then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hd-email-status'] }),
  });

  const cfg = status.data;
  const configured = !!cfg?.configured;

  return (
    <section className="card mb-4 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <Mail size={14}/>Email-to-ticket (POP3)
        </h3>
        {canManage && (
          <button className="btn-primary" disabled={!configured || poll.isPending} onClick={() => poll.mutate()}>
            {poll.isPending ? 'Polling…' : 'Poll now'}
          </button>
        )}
      </div>

      {configured ? (
        <>
          <div className="mb-3 flex items-center gap-2 text-xs">
            <CheckCircle2 size={14} className="text-emerald-600" />
            <span className="text-ink-100">Configured</span>
            <span className="text-ink-300"> · connects to <span className="font-mono">{cfg.user}@{cfg.host}:{cfg.port}</span> ({cfg.security}), auto-poll every minute, {cfg.deleteAfter ? 'DELETEs' : 'keeps'} messages after processing.</span>
          </div>
        </>
      ) : (
        <div className="mb-3 flex items-start gap-2 rounded border border-amber-300 bg-amber-50 p-3 text-xs">
          <XCircle size={14} className="mt-0.5 text-amber-600" />
          <div>
            <div className="font-medium text-amber-900">Not configured</div>
            <div className="mt-1 text-amber-800">
              Add these to <code>/opt/itamls/.env.prod</code> and restart the API to enable:
              <pre className="mt-2 whitespace-pre-wrap rounded bg-white/60 p-2 font-mono text-[11px]">{`HELPDESK_POP3_HOST=pop.gmail.com
HELPDESK_POP3_PORT=995
HELPDESK_POP3_USER=helpdesk@ffgsa.co.za
HELPDESK_POP3_PASS=<app-password>
HELPDESK_POP3_SECURITY=ssl        # ssl | starttls | plain
HELPDESK_POP3_DELETE_AFTER=true
HELPDESK_POP3_MAX_PER_RUN=25`}</pre>
            </div>
          </div>
        </div>
      )}

      {poll.data && (
        <div className="rounded border border-brand-200 bg-brand-50 p-3 text-xs">
          <div className="font-medium text-brand-800">Last manual poll</div>
          <div className="mt-1 text-brand-700">
            {poll.data.error ? poll.data.error :
              `Processed ${poll.data.processed} of ${poll.data.totalOnServer} on the server · ${poll.data.newTickets} new ticket(s), ${poll.data.newComments} comment(s), ${poll.data.skipped} skipped.`}
          </div>
        </div>
      )}

      <p className="mt-3 text-[11px] text-ink-300">
        How it works: every minute, the API connects to the POP3 mailbox, parses each new message, and either:{' '}
        <b>creates a new ticket</b> (subject → title, body → description, sender email → reporter if it matches an ITAMLS user, category defaults to "Other / MISC" or "IT Request"),{' '}
        <b>appends as a comment</b> to an existing ticket if the subject contains the ticket code like <code>[FF-2610-0042]</code>.
        Email attachments are pulled through and stored just like an in-app upload. Successfully processed messages are DELETEd from the server (or left if you set <code>HELPDESK_POP3_DELETE_AFTER=false</code>).
      </p>
    </section>
  );
}

// ---------------- Canned responses panel ----------------
function CannedResponsesPanel({ canManage, categories }: { canManage: boolean; categories: any[] }) {
  const qc = useQueryClient();
  const items = useQuery({
    queryKey: ['hd-canned-all'],
    queryFn: () => api.get('/helpdesk/canned/all').then((r) => r.data),
  });

  const empty = { name: '', body: '', categoryId: '', isActive: true };
  const [draft, setDraft] = useState<any>(empty);
  const [editing, setEditing] = useState<any | null>(null);
  const [creating, setCreating] = useState(false);

  const save = useMutation({
    mutationFn: () => {
      const body = { ...draft, categoryId: draft.categoryId || null };
      return editing
        ? api.patch(`/helpdesk/canned/${editing.id}`, body).then((r) => r.data)
        : api.post('/helpdesk/canned', body).then((r) => r.data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['hd-canned-all'] });
      qc.invalidateQueries({ queryKey: ['canned'] });
      setCreating(false); setEditing(null); setDraft(empty);
    },
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/helpdesk/canned/${id}`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hd-canned-all'] }),
  });

  return (
    <section className="card mb-4 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <MessageSquare size={14}/>Canned responses
        </h3>
        {canManage && (
          <button className="btn-primary" onClick={() => { setCreating((v) => !v); setEditing(null); setDraft(empty); }}>
            <Plus size={13}/>{creating ? 'Cancel' : 'Add response'}
          </button>
        )}
      </div>

      {(creating || editing) && canManage && (
        <div className="mb-3 grid grid-cols-1 gap-2 rounded border border-ink-500/20 bg-slate-50 p-3 md:grid-cols-3">
          <div>
            <label className="label">Name</label>
            <input className="field" placeholder="e.g. Ask for screenshot"
              value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </div>
          <div>
            <label className="label">Scope to category (optional)</label>
            <select className="field" value={draft.categoryId}
              onChange={(e) => setDraft({ ...draft, categoryId: e.target.value })}>
              <option value="">Any category</option>
              {categories.map((c: any) => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
            </select>
          </div>
          <div className="flex items-end">
            <label className="flex items-center gap-1 text-sm">
              <input type="checkbox" checked={draft.isActive}
                onChange={(e) => setDraft({ ...draft, isActive: e.target.checked })} />
              Active
            </label>
          </div>
          <div className="md:col-span-3">
            <label className="label">Body</label>
            <textarea className="field font-mono text-sm" rows={5}
              placeholder={`Hi {{reporter.firstName}},\n\nCould you send a screenshot of {{ticket.subject}}?\n\n— IT`}
              value={draft.body} onChange={(e) => setDraft({ ...draft, body: e.target.value })} />
            <p className="mt-1 text-[11px] text-ink-300">
              Placeholders: <code>{'{{reporter.firstName}}'}</code>, <code>{'{{reporter.fullName}}'}</code>,
              <code> {'{{ticket.code}}'}</code>, <code>{'{{ticket.subject}}'}</code>,
              <code> {'{{store.code}}'}</code>, <code>{'{{store.name}}'}</code>,
              <code> {'{{tech.firstName}}'}</code>, <code>{'{{asset.tag}}'}</code>.
            </p>
          </div>
          <div className="md:col-span-3">
            <button className="btn-primary" disabled={!draft.name || !draft.body || save.isPending} onClick={() => save.mutate()}>
              <Save size={12}/>{save.isPending ? 'Saving…' : editing ? 'Save' : 'Create'}
            </button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="th text-left">Name</th>
              <th className="th text-left">Preview</th>
              <th className="th text-left">Scope</th>
              <th className="th text-right">Used</th>
              <th className="th text-left">Active</th>
              <th className="th text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.data?.length === 0 && (
              <tr><td colSpan={6} className="py-4 text-center text-xs text-ink-300">
                No canned responses yet. Click "Add response" to create one — e.g. "Reboot and try again" or "Request screenshot".
              </td></tr>
            )}
            {items.data?.map((c: any) => (
              <tr key={c.id} className="border-b border-ink-500/10">
                <td className="py-2 font-medium">{c.name}</td>
                <td className="py-2 text-xs text-ink-300 max-w-md line-clamp-2 whitespace-pre-wrap">{c.body}</td>
                <td className="py-2 text-xs">{c.category ? `${c.category.code}` : 'Any'}</td>
                <td className="py-2 text-right text-xs">{c.usageCount}</td>
                <td className="py-2 text-xs">{c.isActive ? '✓' : '—'}</td>
                <td className="py-2 text-right">
                  {canManage && (
                    <div className="flex justify-end gap-1">
                      <button className="btn-ghost" onClick={() => { setEditing(c); setCreating(false); setDraft({ name: c.name, body: c.body, categoryId: c.categoryId ?? '', isActive: c.isActive }); }}>
                        Edit
                      </button>
                      <button className="btn-ghost text-rose-500"
                        onClick={() => { if (confirm(`Delete "${c.name}"?`)) remove.mutate(c.id); }}>
                        <Trash2 size={12}/>
                      </button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

// ---------------- Webhooks panel ----------------
function WebhooksPanel() {
  const qc = useQueryClient();
  const hasPerm = useAuth((s) => s.hasPermission);
  const canManage = hasPerm('tickets:manage:webhooks');
  const hooks = useQuery({
    queryKey: ['hd-webhooks'],
    queryFn: () => api.get('/helpdesk/webhooks').then((r) => r.data).catch(() => []),
    enabled: canManage,
  });
  const [creating, setCreating] = useState(false);
  const emptyHook = { name: '', url: '', events: 'ticket.*', secret: '' };
  const [draft, setDraft] = useState<any>(emptyHook);

  const save = useMutation({
    mutationFn: () => api.post('/helpdesk/webhooks', draft).then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['hd-webhooks'] }); setCreating(false); setDraft(emptyHook); },
  });
  const toggle = useMutation({
    mutationFn: ({ id, isActive }: any) => api.patch(`/helpdesk/webhooks/${id}`, { isActive }).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hd-webhooks'] }),
  });
  const remove = useMutation({
    mutationFn: (id: string) => api.delete(`/helpdesk/webhooks/${id}`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hd-webhooks'] }),
  });
  const test = useMutation({
    mutationFn: (id: string) => api.post(`/helpdesk/webhooks/${id}/test`).then((r) => r.data),
  });
  const [recentId, setRecentId] = useState<string | null>(null);
  const recent = useQuery({
    queryKey: ['hd-webhook-recent', recentId],
    queryFn: () => api.get(`/helpdesk/webhooks/${recentId}/deliveries`).then((r) => r.data),
    enabled: !!recentId,
    refetchInterval: 5_000,
  });

  if (!canManage) return null;

  return (
    <section className="card mb-4 p-4">
      <div className="mb-3 flex items-center justify-between">
        <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-700">
          <Webhook size={14}/>Outbound webhooks
        </h3>
        <button className="btn-primary" onClick={() => setCreating((v) => !v)}>
          <Plus size={13}/>{creating ? 'Cancel' : 'Add webhook'}
        </button>
      </div>

      {creating && (
        <div className="mb-3 grid grid-cols-1 gap-2 rounded border border-ink-500/20 bg-slate-50 p-3 md:grid-cols-4">
          <div className="md:col-span-1">
            <label className="label">Name</label>
            <input className="field" value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} />
          </div>
          <div className="md:col-span-2">
            <label className="label">URL</label>
            <input className="field font-mono text-xs" placeholder="https://ops.example.com/webhooks/itamls"
              value={draft.url} onChange={(e) => setDraft({ ...draft, url: e.target.value })} />
          </div>
          <div>
            <label className="label">Events</label>
            <input className="field font-mono text-xs"
              placeholder="ticket.* or ticket.created,ticket.resolved"
              value={draft.events} onChange={(e) => setDraft({ ...draft, events: e.target.value })} />
          </div>
          <div className="md:col-span-3">
            <label className="label">Signing secret (optional — sent as HMAC-SHA256 in X-ITAMLS-Signature)</label>
            <input className="field font-mono text-xs" value={draft.secret}
              onChange={(e) => setDraft({ ...draft, secret: e.target.value })} />
          </div>
          <div className="flex items-end">
            <button className="btn-primary" disabled={!draft.name || !draft.url || save.isPending} onClick={() => save.mutate()}>
              <Save size={12}/>{save.isPending ? 'Saving…' : 'Create'}
            </button>
          </div>
        </div>
      )}

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50">
            <tr>
              <th className="th text-left">Name</th>
              <th className="th text-left">URL</th>
              <th className="th text-left">Events</th>
              <th className="th text-right">Fired</th>
              <th className="th text-right">Failures</th>
              <th className="th text-left">Active</th>
              <th className="th text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {hooks.data?.length === 0 && (
              <tr><td colSpan={7} className="py-4 text-center text-xs text-ink-300">No webhooks configured yet.</td></tr>
            )}
            {hooks.data?.map((h: any) => (
              <tr key={h.id} className="border-b border-ink-500/10">
                <td className="py-2 font-medium">{h.name}</td>
                <td className="py-2 font-mono text-[11px] break-all">{h.url}</td>
                <td className="py-2 font-mono text-[11px]">{h.events}</td>
                <td className="py-2 text-right text-xs">{h.totalFired ?? 0}</td>
                <td className="py-2 text-right text-xs">
                  <span className={h.totalFailed > 0 ? 'text-rose-600' : ''}>{h.totalFailed ?? 0}</span>
                </td>
                <td className="py-2 text-xs">
                  <input type="checkbox" checked={h.isActive}
                    onChange={() => toggle.mutate({ id: h.id, isActive: !h.isActive })} />
                </td>
                <td className="py-2 text-right">
                  <div className="flex justify-end gap-1">
                    <button className="btn-ghost" title="Send test ping" onClick={() => test.mutate(h.id)}>
                      <Zap size={12}/>
                    </button>
                    <button className="btn-ghost" onClick={() => setRecentId(recentId === h.id ? null : h.id)}>
                      {recentId === h.id ? 'Hide log' : 'Log'}
                    </button>
                    <button className="btn-ghost text-rose-500"
                      onClick={() => { if (confirm(`Delete webhook ${h.name}?`)) remove.mutate(h.id); }}>
                      <Trash2 size={12}/>
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {recentId && (
        <div className="mt-3 rounded border border-ink-500/20 bg-slate-50 p-3">
          <h4 className="mb-2 text-xs font-semibold text-slate-700">Recent deliveries</h4>
          <div className="max-h-60 overflow-auto">
            <table className="w-full text-xs">
              <thead>
                <tr>
                  <th className="th text-left">Event</th>
                  <th className="th text-left">When</th>
                  <th className="th text-right">Status</th>
                  <th className="th text-right">ms</th>
                  <th className="th text-left">Error</th>
                </tr>
              </thead>
              <tbody>
                {recent.data?.length === 0 && (
                  <tr><td colSpan={5} className="py-2 text-center text-ink-300">No deliveries yet.</td></tr>
                )}
                {recent.data?.map((d: any) => (
                  <tr key={d.id} className="border-b border-ink-500/10">
                    <td className="py-1 font-mono">{d.event}</td>
                    <td className="py-1">{new Date(d.createdAt).toLocaleString()}</td>
                    <td className="py-1 text-right">
                      <span className={d.success ? 'text-emerald-600' : 'text-rose-600'}>
                        {d.responseStatus ?? '—'}
                      </span>
                    </td>
                    <td className="py-1 text-right">{d.durationMs ?? '—'}</td>
                    <td className="py-1 text-rose-600">{d.error ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      <p className="mt-3 text-[11px] text-ink-300">
        Events are fired as POSTs to the URL. Headers: <code>X-ITAMLS-Event</code>, <code>X-ITAMLS-Delivery</code>, and
        {' '}<code>X-ITAMLS-Signature: sha256=&lt;hmac&gt;</code> when a secret is set. Payload is JSON with
        {' '}<code>{'{event, deliveryId, timestamp, data}'}</code>. Supported events: <code>ticket.created</code>,
        {' '}<code>ticket.status_changed</code>, <code>ticket.priority_changed</code>, <code>ticket.assigned</code>,
        {' '}<code>ticket.comment_added</code>, <code>ticket.resolved</code>, <code>ticket.closed</code>,
        {' '}<code>ticket.reopened</code>, <code>ticket.sla_breached</code>.
      </p>
    </section>
  );
}

// ---------------- Ops App API docs panel ----------------
function OpsApiPanel() {
  const hasPerm = useAuth((s) => s.hasPermission);
  const canManage = hasPerm('tickets:manage:webhooks') || hasPerm('tickets:manage:categories');
  if (!canManage) return null;

  const base = (api.defaults.baseURL ?? '').replace(/\/$/, '');
  const snippet =
`POST ${base}/public/helpdesk/tickets
X-Api-Key: <generate one from Settings → API Keys with scope OPS or FULL>
X-ITAMLS-Reporter-Email: cashier@store012.ffgsa.co.za
X-ITAMLS-Store-Code: 012
Content-Type: application/json

{
  "subject": "POS3 won't print",
  "description": "Receipt printer offline since 09:15",
  "categoryCode": "POS",
  "priority": "P2"
}`;

  return (
    <section className="card mb-4 p-4">
      <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold text-slate-700">
        <FileText size={14}/>Ops-app integration (public API)
      </h3>
      <p className="mb-3 text-[11px] text-ink-300">
        Lets your Ops app log tickets without stores having to open ITAMLS. Create an API key under
        Settings → API Keys with scope OPS or FULL and share it with the Ops app team. Tickets are tagged
        <code> source=OPS_APP</code>.
      </p>
      <pre className="whitespace-pre-wrap rounded bg-slate-900 p-3 font-mono text-[11px] text-slate-100">
{snippet}
      </pre>
      <p className="mt-2 text-[11px] text-ink-300">
        Also available: <code>GET /public/helpdesk/categories</code>,{' '}
        <code>GET /public/helpdesk/tickets/:code</code>,{' '}
        <code>POST /public/helpdesk/tickets/:code/comments</code>.
      </p>
    </section>
  );
}
