import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { PageHeader } from '@/components/PageHeader';
import { Filter, Search } from 'lucide-react';

/**
 * Ticket audit log viewer. Reads /helpdesk/audit (ticket events) with
 * optional ticketId / actorId filters. Mostly for IT managers chasing
 * "who closed this ticket at 2am".
 */
export function HelpdeskAudit() {
  const [ticketCode, setTicketCode] = useState('');
  const [actorEmail, setActorEmail] = useState('');
  const [limit, setLimit] = useState(200);

  const users = useQuery({
    queryKey: ['users-mini'],
    queryFn: () => api.get('/users').then((r) => r.data).catch(() => []),
  });

  // Resolve ticket code → id client-side (one tiny lookup) so operators type
  // human codes, not cuids.
  const tickets = useQuery({
    queryKey: ['tickets-by-code', ticketCode],
    queryFn: () => api.get('/helpdesk/tickets', { params: { q: ticketCode } }).then((r) => r.data),
    enabled: !!ticketCode.trim(),
  });
  const resolvedTicketId = tickets.data?.items?.find?.(
    (t: any) => t.code === ticketCode.trim().toUpperCase(),
  )?.id;

  const actorId = users.data?.find?.(
    (u: any) => u.email.toLowerCase() === actorEmail.trim().toLowerCase(),
  )?.id;

  const events = useQuery({
    queryKey: ['hd-audit', resolvedTicketId, actorId, limit],
    queryFn: () => api.get('/helpdesk/audit', {
      params: {
        ticketId: resolvedTicketId || undefined,
        actorId:  actorId          || undefined,
        limit,
      },
    }).then((r) => r.data),
  });

  return (
    <>
      <PageHeader
        title="Helpdesk — audit log"
        subtitle="Every status change, assignment, comment, breach — searchable"
      />

      <section className="card mb-4 p-3">
        <div className="mb-2 flex items-center gap-2 text-xs font-semibold text-ink-300">
          <Filter size={12}/>Filters
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <label className="label">Ticket code</label>
            <div className="relative">
              <Search size={13} className="absolute left-2 top-2.5 text-ink-300"/>
              <input className="field pl-7 font-mono" placeholder="FF-2611-0042"
                value={ticketCode} onChange={(e) => setTicketCode(e.target.value.toUpperCase())}/>
            </div>
          </div>
          <div>
            <label className="label">Actor email</label>
            <input className="field" placeholder="tech@fashionfusion.local"
              value={actorEmail} onChange={(e) => setActorEmail(e.target.value)}/>
          </div>
          <div>
            <label className="label">Max rows</label>
            <select className="field" value={limit} onChange={(e) => setLimit(Number(e.target.value))}>
              <option value={100}>100</option>
              <option value={200}>200</option>
              <option value={500}>500</option>
              <option value={1000}>1000</option>
            </select>
          </div>
        </div>
      </section>

      <section className="card p-0">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="th text-left">When</th>
                <th className="th text-left">Ticket</th>
                <th className="th text-left">Actor</th>
                <th className="th text-left">Event</th>
                <th className="th text-left">From → To</th>
                <th className="th text-left">Notes</th>
              </tr>
            </thead>
            <tbody>
              {events.data?.length === 0 && (
                <tr><td colSpan={6} className="py-6 text-center text-xs text-ink-300">No events match these filters.</td></tr>
              )}
              {events.data?.map((e: any) => (
                <tr key={e.id} className="border-t border-ink-500/10">
                  <td className="py-2 pl-3 text-[11px] text-ink-300 font-mono">
                    {new Date(e.occurredAt).toLocaleString()}
                  </td>
                  <td className="py-2">
                    <Link className="font-mono text-brand-700 hover:underline"
                      to={`/helpdesk/tickets/${e.ticketId}`}>
                      {e.ticket?.code ?? '—'}
                    </Link>
                    <div className="text-[10px] text-ink-300 line-clamp-1">{e.ticket?.subject}</div>
                  </td>
                  <td className="py-2 text-xs">{e.actor?.fullName ?? <span className="italic text-ink-300">system</span>}</td>
                  <td className="py-2">
                    <span className="rounded bg-slate-100 px-2 py-0.5 font-mono text-[10px]">{e.eventType}</span>
                  </td>
                  <td className="py-2 text-xs text-ink-300">
                    {(e.fromValue || e.toValue) ? `${e.fromValue ?? '—'} → ${e.toValue ?? '—'}` : '—'}
                  </td>
                  <td className="py-2 pr-3 text-xs">{e.notes ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
