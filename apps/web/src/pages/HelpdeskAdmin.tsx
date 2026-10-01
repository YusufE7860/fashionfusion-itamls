import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { PageHeader } from '@/components/PageHeader';
import { useAuth } from '@/store/auth';
import { CheckCircle2, Mail, Plus, Save, Trash2, X, XCircle } from 'lucide-react';

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
  const emptyCat = { code: '', name: '', defaultPriority: 'P3', defaultAssigneeId: '', slaPolicyId: '', sortOrder: 100, isActive: true };
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
