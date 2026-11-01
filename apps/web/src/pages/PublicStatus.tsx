import { useQuery } from '@tanstack/react-query';
import axios from 'axios';
import { CheckCircle2, AlertTriangle, AlertCircle, ShieldAlert, Wrench } from 'lucide-react';

/**
 * Unauthenticated public status page. Hits /api/v1/public/status directly
 * (no Authorization header, no JWT) so store staff and customers can bookmark
 * and refresh without logging in.
 *
 * Visually loud: the overall banner at the top uses colour + an icon so
 * someone glancing at it from across the room knows "all good" vs "fire".
 */
const STATUS_META: Record<string, { label: string; color: string; icon: any }> = {
  ALL_CLEAR:   { label: 'All systems operational',       color: 'bg-emerald-500',  icon: CheckCircle2 },
  MAINTENANCE: { label: 'Scheduled maintenance',          color: 'bg-sky-500',      icon: Wrench },
  MINOR:       { label: 'Minor issue affecting some services', color: 'bg-amber-500', icon: AlertTriangle },
  MAJOR:       { label: 'Major issue affecting services', color: 'bg-orange-500',   icon: AlertCircle },
  CRITICAL:    { label: 'Critical outage',                color: 'bg-rose-600',     icon: ShieldAlert },
};

const SEV_META: Record<string, string> = {
  MAINTENANCE: 'bg-sky-100 text-sky-700',
  MINOR:       'bg-amber-100 text-amber-700',
  MAJOR:       'bg-orange-100 text-orange-700',
  CRITICAL:    'bg-rose-100 text-rose-700',
};

const INC_STATUS_META: Record<string, string> = {
  INVESTIGATING: 'bg-amber-100 text-amber-700',
  IDENTIFIED:    'bg-sky-100 text-sky-700',
  MONITORING:    'bg-violet-100 text-violet-700',
  RESOLVED:      'bg-emerald-100 text-emerald-700',
};

export function PublicStatus() {
  // Use axios directly (not our auth-aware api client) so this page works
  // even when the user is signed out or has an expired JWT.
  const status = useQuery({
    queryKey: ['public-status'],
    queryFn: () => axios.get('/api/v1/public/status').then((r) => r.data),
    refetchInterval: 30_000,
  });

  const overall = status.data?.overall ?? 'ALL_CLEAR';
  const meta = STATUS_META[overall] ?? STATUS_META.ALL_CLEAR;
  const Icon = meta.icon;

  return (
    <div className="min-h-screen bg-slate-50 py-6 sm:py-12">
      <div className="mx-auto max-w-3xl px-4">
        <h1 className="mb-6 text-center font-display text-xl font-bold text-ink-50 sm:text-2xl">
          Fashion Fusion ITAMLS — System Status
        </h1>

        <div className={`mb-6 flex items-center gap-4 rounded-xl ${meta.color} p-5 text-white shadow-lg`}>
          <Icon size={32} className="shrink-0"/>
          <div>
            <div className="text-xs font-semibold uppercase tracking-wider opacity-80">Current status</div>
            <div className="text-xl font-bold">{meta.label}</div>
          </div>
        </div>

        {/* Active incidents */}
        <section className="mb-6">
          <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-ink-300">Active incidents</h2>
          {!status.data?.active?.length ? (
            <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">
              Nothing currently open. All services are running normally.
            </div>
          ) : (
            <ul className="space-y-3">
              {status.data.active.map((i: any) => (
                <li key={i.id} className="rounded-xl border border-ink-500/10 bg-white p-4 shadow-sm">
                  <div className="mb-2 flex flex-wrap items-center gap-2">
                    <span className={`rounded px-2 py-0.5 text-[11px] font-semibold ${SEV_META[i.severity]}`}>{i.severity}</span>
                    <span className={`rounded px-2 py-0.5 text-[11px] font-medium ${INC_STATUS_META[i.status]}`}>{i.status}</span>
                    {(i.affectedServices ?? '').split(',').filter(Boolean).map((s: string) => (
                      <span key={s} className="rounded bg-slate-100 px-2 py-0.5 text-[10px] font-mono text-ink-300">{s}</span>
                    ))}
                    <span className="ml-auto text-[11px] text-ink-300">
                      started {new Date(i.startedAt).toLocaleString()}
                    </span>
                  </div>
                  <h3 className="text-base font-semibold text-ink-50">{i.title}</h3>
                  <p className="mt-1 whitespace-pre-wrap text-sm text-ink-200">{i.summary}</p>
                  {i.updates?.length > 0 && (
                    <ul className="mt-3 space-y-2 border-t pt-3">
                      {i.updates.map((u: any) => (
                        <li key={u.id} className="text-xs">
                          <span className="mr-2 rounded bg-slate-100 px-1.5 py-0.5 font-mono text-[10px]">{u.status}</span>
                          <span className="text-ink-300">{new Date(u.postedAt).toLocaleString()}</span>
                          <div className="mt-0.5 text-ink-100">{u.body}</div>
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>

        {/* Recently resolved */}
        {status.data?.recentResolved?.length > 0 && (
          <section>
            <h2 className="mb-2 text-sm font-semibold uppercase tracking-wider text-ink-300">
              Recently resolved (14 days)
            </h2>
            <ul className="space-y-2">
              {status.data.recentResolved.map((i: any) => (
                <li key={i.id} className="rounded-lg border border-ink-500/10 bg-white p-3 text-sm">
                  <div className="flex items-center gap-2">
                    <CheckCircle2 size={14} className="text-emerald-600"/>
                    <span className="font-medium">{i.title}</span>
                    <span className="ml-auto text-[11px] text-ink-300">
                      {i.resolvedAt && `resolved ${new Date(i.resolvedAt).toLocaleDateString()}`}
                    </span>
                  </div>
                </li>
              ))}
            </ul>
          </section>
        )}

        <footer className="mt-10 text-center text-[11px] text-ink-300">
          Status refreshes every 30 seconds · For IT support, log a ticket in the Fashion Fusion ITAMLS portal.
        </footer>
      </div>
    </div>
  );
}
