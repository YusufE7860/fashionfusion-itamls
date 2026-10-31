import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { useAuth } from '@/store/auth';
import { Eye, Link as LinkIcon, Check, X, UserPlus, Trash2, TrendingUp } from 'lucide-react';

/**
 * Right-side panel that groups all Helpdesk v3 widgets for a single ticket:
 *   - Watchers (add / remove / email-only)
 *   - Links to other tickets (merge, related, duplicate_of)
 *   - Approvals (request + decide)
 *   - SLA burn-down (effective vs target vs paused)
 *
 * Rendered under the existing Actions card on HelpdeskDetail.
 */
export function TicketV3Panel({ ticketId }: { ticketId: string }) {
  const qc = useQueryClient();
  const hasPerm = useAuth((s) => s.hasPermission);
  const canWrite  = hasPerm('tickets:write');
  const canMerge  = hasPerm('tickets:merge');
  const canReport = hasPerm('tickets:reports');

  const watchers = useQuery({
    queryKey: ['t-watchers', ticketId],
    queryFn: () => api.get(`/helpdesk/tickets/${ticketId}/watchers`).then((r) => r.data),
  });
  const links = useQuery({
    queryKey: ['t-links', ticketId],
    queryFn: () => api.get(`/helpdesk/tickets/${ticketId}/links`).then((r) => r.data),
  });
  const approvals = useQuery({
    queryKey: ['t-approvals', ticketId],
    queryFn: () => api.get(`/helpdesk/tickets/${ticketId}/approvals`).then((r) => r.data),
  });
  const burn = useQuery({
    queryKey: ['t-burn', ticketId],
    queryFn: () => api.get(`/helpdesk/metrics/sla-burn-down/${ticketId}`).then((r) => r.data).catch(() => null),
    refetchInterval: 60_000,
    enabled: canReport,
  });

  const addWatcher = useMutation({
    mutationFn: (body: any) => api.post(`/helpdesk/tickets/${ticketId}/watchers`, body).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['t-watchers', ticketId] }),
  });
  const rmWatcher = useMutation({
    mutationFn: (wid: string) => api.delete(`/helpdesk/tickets/${ticketId}/watchers/${wid}`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['t-watchers', ticketId] }),
  });
  const addLink = useMutation({
    mutationFn: (body: any) => api.post(`/helpdesk/tickets/links`, body).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['t-links', ticketId] }),
  });
  const rmLink = useMutation({
    mutationFn: (lid: string) => api.delete(`/helpdesk/tickets/links/${lid}`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['t-links', ticketId] }),
  });
  const requestAppr = useMutation({
    mutationFn: (body: any) => api.post(`/helpdesk/tickets/${ticketId}/approvals`, body).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['t-approvals', ticketId] }),
  });
  const decideAppr = useMutation({
    mutationFn: ({ id, body }: any) => api.patch(`/helpdesk/approvals/${id}`, body).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['t-approvals', ticketId] }),
  });

  return (
    <>
      {/* ---------- SLA burn-down ---------- */}
      {canReport && burn.data && (
        <section className="card p-4">
          <h3 className="mb-2 flex items-center gap-1 text-sm font-semibold text-slate-700">
            <TrendingUp size={13}/>SLA burn-down
          </h3>
          {renderBurn(burn.data)}
        </section>
      )}

      {/* ---------- Watchers ---------- */}
      <section className="card p-4">
        <h3 className="mb-2 flex items-center gap-1 text-sm font-semibold text-slate-700">
          <Eye size={13}/>Watchers
        </h3>
        <ul className="mb-2 space-y-1 text-xs">
          {watchers.data?.length === 0 && <li className="text-ink-300">No watchers.</li>}
          {watchers.data?.map((w: any) => (
            <li key={w.id} className="flex items-center justify-between rounded border border-ink-500/10 p-2">
              <span>{w.user?.fullName ?? w.email}</span>
              {canWrite && (
                <button className="btn-ghost text-rose-500" onClick={() => rmWatcher.mutate(w.id)}>
                  <Trash2 size={11}/>
                </button>
              )}
            </li>
          ))}
        </ul>
        {canWrite && (
          <button className="btn-ghost text-xs"
            onClick={() => {
              const v = prompt('Watcher email (or @username to look up):');
              if (!v?.trim()) return;
              if (v.includes('@')) addWatcher.mutate({ email: v.trim().toLowerCase() });
              else alert('Prefix with @ not supported — paste the email instead.');
            }}>
            <UserPlus size={11}/>Add watcher
          </button>
        )}
      </section>

      {/* ---------- Links ---------- */}
      <section className="card p-4">
        <h3 className="mb-2 flex items-center gap-1 text-sm font-semibold text-slate-700">
          <LinkIcon size={13}/>Related tickets
        </h3>
        <ul className="mb-2 space-y-1 text-xs">
          {links.data?.length === 0 && <li className="text-ink-300">No links.</li>}
          {links.data?.map((l: any) => {
            const other = l.sourceId === ticketId ? l.target : l.source;
            return (
              <li key={l.id} className="flex items-center justify-between rounded border border-ink-500/10 p-2">
                <a className="truncate text-brand-700 hover:underline" href={`/helpdesk/${other.id}`}>
                  <span className="mr-1 rounded bg-slate-100 px-1 py-0.5 text-[10px] font-mono">{l.kind}</span>
                  {other.code} — {other.subject}
                </a>
                {canMerge && (
                  <button className="btn-ghost text-rose-500" onClick={() => rmLink.mutate(l.id)}>
                    <Trash2 size={11}/>
                  </button>
                )}
              </li>
            );
          })}
        </ul>
        {canMerge && (
          <button className="btn-ghost text-xs"
            onClick={() => {
              const code = prompt('Target ticket code (e.g. FF-2610-0042):');
              if (!code?.trim()) return;
              const kind = prompt('Kind: MERGED | RELATED | DUPLICATE_OF | BLOCKS | BLOCKED_BY', 'RELATED')?.toUpperCase();
              if (!kind) return;
              api.get(`/helpdesk/tickets?code=${encodeURIComponent(code.trim())}`).then((r) => {
                const target = (r.data?.rows ?? r.data ?? []).find((t: any) => t.code === code.trim().toUpperCase());
                if (!target) return alert(`No ticket found with code ${code}`);
                addLink.mutate({ sourceId: ticketId, targetId: target.id, kind });
              });
            }}>
            <LinkIcon size={11}/>Link to another ticket
          </button>
        )}
      </section>

      {/* ---------- Approvals ---------- */}
      <section className="card p-4">
        <h3 className="mb-2 text-sm font-semibold text-slate-700">Approvals</h3>
        <ul className="mb-2 space-y-1 text-xs">
          {approvals.data?.length === 0 && <li className="text-ink-300">No approvals requested.</li>}
          {approvals.data?.map((a: any) => (
            <li key={a.id} className="rounded border border-ink-500/10 p-2">
              <div className="flex items-center justify-between">
                <div>
                  <div className="font-mono text-[11px]">
                    {a.approver.fullName}
                    <span className={`ml-2 rounded px-1 py-0.5 text-[10px] ${
                      a.status === 'APPROVED' ? 'bg-emerald-100 text-emerald-700' :
                      a.status === 'REJECTED' ? 'bg-rose-100 text-rose-700' :
                      a.status === 'PENDING'  ? 'bg-amber-100 text-amber-700' :
                                                'bg-slate-100 text-slate-500'
                    }`}>{a.status}</span>
                  </div>
                  <div className="text-[10px] text-ink-300">
                    asked by {a.requester.fullName} · {new Date(a.requestedAt).toLocaleString()}
                  </div>
                  {a.reason && <div className="mt-1 text-[11px] italic">"{a.reason}"</div>}
                </div>
                {a.status === 'PENDING' && (
                  <div className="flex gap-1">
                    <button className="btn-ghost text-emerald-700"
                      onClick={() => {
                        const r = prompt('Approval note (optional):', '');
                        decideAppr.mutate({ id: a.id, body: { status: 'APPROVED', reason: r } });
                      }}>
                      <Check size={11}/>
                    </button>
                    <button className="btn-ghost text-rose-600"
                      onClick={() => {
                        const r = prompt('Rejection reason:');
                        if (!r?.trim()) return;
                        decideAppr.mutate({ id: a.id, body: { status: 'REJECTED', reason: r } });
                      }}>
                      <X size={11}/>
                    </button>
                  </div>
                )}
              </div>
            </li>
          ))}
        </ul>
        {canWrite && (
          <button className="btn-ghost text-xs"
            onClick={() => {
              const email = prompt('Approver email (must be an ITAMLS user):');
              if (!email?.trim()) return;
              api.get('/users').then((r) => {
                const u = (r.data ?? []).find((x: any) =>
                  x.email.toLowerCase() === email.trim().toLowerCase());
                if (!u) return alert(`No user with email ${email}`);
                requestAppr.mutate({ approverId: u.id });
              });
            }}>
            <UserPlus size={11}/>Request approval
          </button>
        )}
      </section>
    </>
  );
}

function renderBurn(b: any) {
  const pct = Math.max(0, Math.min(100, (b.effectiveMs / b.targetMs) * 100));
  const remaining = Math.max(0, b.remainingMs);
  const fmt = (ms: number) => {
    const m = Math.floor(ms / 60_000);
    const h = Math.floor(m / 60);
    const d = Math.floor(h / 24);
    if (d >= 1) return `${d}d ${h % 24}h`;
    if (h >= 1) return `${h}h ${m % 60}m`;
    return `${m}m`;
  };
  return (
    <div>
      <div className="mb-1 h-2 overflow-hidden rounded bg-slate-200">
        <div className={`h-full ${b.breached ? 'bg-rose-500' : pct > 80 ? 'bg-amber-500' : 'bg-emerald-500'}`}
          style={{ width: `${pct}%` }}/>
      </div>
      <div className="flex justify-between text-[11px] text-ink-300">
        <span>Elapsed {fmt(b.effectiveMs)}</span>
        <span>{b.breached ? `Breached by ${fmt(-b.remainingMs)}` : `${fmt(remaining)} left`}</span>
      </div>
      <div className="mt-1 text-[10px] text-ink-300">
        Paused: {fmt(b.pausedMs)} · Target: {fmt(b.targetMs)}
      </div>
    </div>
  );
}
