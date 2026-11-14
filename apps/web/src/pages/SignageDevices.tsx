import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { PageHeader } from '@/components/PageHeader';
import { useAuth } from '@/store/auth';
import { Monitor, RefreshCw, RotateCw, Eye, X, ShieldAlert, Shield, Play, Download, Pencil, Trash2, Terminal, Check } from 'lucide-react';
import clsx from 'clsx';

export function SignageDevices() {
  const qc = useQueryClient();
  const hasPerm = useAuth((s) => s.hasPermission);
  // Signage techs should be able to edit orientation, rotation, brand,
  // store and other per-device settings without being granted broad store
  // management rights. The dedicated `signage:devices:write` permission is
  // the right gate; we keep `stores:write` as a legacy fallback so
  // existing admin accounts don't lose access at deploy time.
  const canWrite = hasPerm('signage:devices:write') || hasPerm('stores:write');
  const [viewing, setViewing] = useState<any | null>(null);
  const [showInstaller, setShowInstaller] = useState(false);
  // Which row is currently in rename mode + its draft value.
  const [renaming, setRenaming] = useState<{ id: string; draft: string } | null>(null);

  const devices = useQuery({
    queryKey: ['signage-devices'],
    queryFn: () => api.get('/signage/devices').then((r) => r.data),
    refetchInterval: 10_000,
  });
  const stores = useQuery({ queryKey: ['stores'], queryFn: () => api.get('/stores').then((r) => r.data) });

  const update = useMutation({
    mutationFn: ({ id, body }: any) => api.patch(`/signage/devices/${id}`, body).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['signage-devices'] }),
  });
  const resync = useMutation({
    mutationFn: (id: string) => api.post(`/signage/devices/${id}/resync`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['signage-devices'] }),
  });

  const removeDevice = useMutation({
    mutationFn: (id: string) => api.delete(`/signage/devices/${id}`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['signage-devices'] }),
    onError: (e: any) => alert(e?.response?.data?.message ?? 'Delete failed'),
  });

  // Sync all players in a store so every TV restarts playback at the same
  // wall-clock instant. The server schedules a SYNC_PLAY_AT command on each
  // device with a lead window (default 75s) long enough for every agent to
  // poll before firing.
  const syncStore = useMutation({
    mutationFn: (storeId: string) =>
      api.post(`/signage/exec/sync-store/${storeId}`, {}).then((r) => r.data),
    onSuccess: (data: any) => {
      const when = data?.atIso ? new Date(data.atIso).toLocaleTimeString() : '(soon)';
      alert(`Queued sync on ${data?.queued ?? 0} player(s). They will all restart at ${when}.`);
    },
    onError: (e: any) => alert(e?.response?.data?.message ?? 'Could not queue sync'),
  });

  // Queue signage-reinstall on every device in a store. One-click fleet
  // upgrade when the agent tarball has moved forward.
  const reinstallStore = useMutation({
    mutationFn: (storeId: string) =>
      api.post(`/signage/exec/reinstall-store/${storeId}`, {}).then((r) => r.data),
    onSuccess: (data: any) =>
      alert(`Reinstall queued on ${data?.queued ?? 0} player(s). Each will pull the latest agent build and restart on its next poll (~60s).`),
    onError: (e: any) => alert(e?.response?.data?.message ?? 'Could not queue reinstall'),
  });

  const online = devices.data?.filter((d: any) => d.online).length ?? 0;
  const total = devices.data?.length ?? 0;

  const canManage = hasPerm('agents:remote-manage');
  const freeze = useQuery({
    queryKey: ['fleet-freeze'],
    queryFn: () => api.get('/signage/exec/freeze').then((r) => r.data).catch(() => null),
    refetchInterval: 10_000,
  });
  const toggleFreeze = useMutation({
    mutationFn: (body: { frozen: boolean; reason?: string }) =>
      api.post('/signage/exec/freeze', body).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['fleet-freeze'] }),
    onError: (e: any) => alert(e?.response?.data?.message ?? 'Could not toggle freeze'),
  });

  // One-off HMAC bypass used to recover a fleet whose agents are on an older
  // canonicalizer. See RemoteExecService — poll freshly every 20s so the
  // "active" banner clears automatically when the window expires.
  const hmacBypass = useQuery({
    queryKey: ['hmac-bypass'],
    queryFn: () => api.get('/signage/exec/hmac-bypass').then((r) => r.data).catch(() => null),
    refetchInterval: 20_000,
  });
  const setHmacBypass = useMutation({
    mutationFn: (minutes: number) =>
      api.post('/signage/exec/hmac-bypass', { minutes }).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['hmac-bypass'] }),
    onError: (e: any) => alert(e?.response?.data?.message ?? 'Could not toggle HMAC bypass'),
  });
  const bypassActive = !!hmacBypass.data?.until && new Date(hmacBypass.data.until).getTime() > Date.now();
  const bypassMinsLeft = bypassActive
    ? Math.max(0, Math.ceil((new Date(hmacBypass.data.until).getTime() - Date.now()) / 60_000))
    : 0;

  // Group devices by store so each store becomes its own section with a
  // "Sync store" button. Devices with no store assigned fall into an
  // "Unassigned" group pinned to the bottom.
  const grouped = useMemo(() => {
    const bucket = new Map<string, { key: string; storeId: string | null; label: string; devices: any[] }>();
    for (const d of (devices.data ?? [])) {
      const key = d.storeId ?? '__none__';
      const label = d.store ? `${d.store.code} — ${d.store.name}` : 'No store assigned';
      if (!bucket.has(key)) bucket.set(key, { key, storeId: d.storeId ?? null, label, devices: [] });
      bucket.get(key)!.devices.push(d);
    }
    return [...bucket.values()].sort((a, b) => {
      if (!a.storeId) return 1;
      if (!b.storeId) return -1;
      return a.label.localeCompare(b.label);
    });
  }, [devices.data]);

  return (
    <>
      <PageHeader
        title="Signage — Media players"
        subtitle={`${online} of ${total} players online`}
        actions={canManage && (
          <>
            <button className="btn-ghost" title="Show the one-line installer command"
              onClick={() => setShowInstaller(true)}>
              <Terminal size={13}/>Installer
            </button>
            {bypassActive ? (
              <button className="btn-ghost text-amber-700"
                onClick={() => {
                  if (!confirm('End the HMAC bypass window early?')) return;
                  setHmacBypass.mutate(0);
                }}>
                Bypass active · {bypassMinsLeft}m — end now
              </button>
            ) : (
              <button className="btn-ghost text-amber-700"
                onClick={() => {
                  if (!confirm(
                    'Enable a 15-minute window where RUN_PREDEFINED commands are sent WITHOUT HMAC.\n\n' +
                    'Use ONLY to recover devices whose agents can\'t verify HMAC yet. ' +
                    'After rolling out signage-reinstall across the fleet, end the window or let it expire.',
                  )) return;
                  setHmacBypass.mutate(15);
                }}>
                Enable HMAC bypass (15m)
              </button>
            )}
            {freeze.data?.frozen ? (
              <button className="btn-ghost text-emerald-700"
                onClick={() => {
                  if (!confirm('Unfreeze the fleet? Queued commands will start executing.')) return;
                  toggleFreeze.mutate({ frozen: false });
                }}>
                <Shield size={13}/>Unfreeze fleet
              </button>
            ) : (
              <button className="btn-ghost text-rose-600"
                onClick={() => {
                  const reason = prompt('Reason for freezing (audited):');
                  if (!reason?.trim()) return;
                  toggleFreeze.mutate({ frozen: true, reason });
                }}>
                <ShieldAlert size={13}/>Freeze fleet
              </button>
            )}
          </>
        )}
      />
      {bypassActive && (
        <div className="mb-3 rounded border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900">
          <b>HMAC bypass active for the next {bypassMinsLeft} minute(s).</b> New RUN_PREDEFINED commands are
          dispatched without a signature so pre-fix agents can accept them. Roll out <code>signage-reinstall</code>
          to every device while this window is open; the setting auto-expires.
        </div>
      )}
      {freeze.data?.frozen && (
        <div className="mb-3 rounded border border-rose-300 bg-rose-50 p-3 text-xs text-rose-900">
          <b>Fleet is FROZEN.</b> No commands are being dispatched to any device.
          Reason: <i>{freeze.data.reason ?? '—'}</i>. Unfreeze from the top-right button.
        </div>
      )}
      {devices.data?.length === 0 && (
        <section className="card p-6 text-center text-xs text-ink-300">
          No signage devices yet. The agent on a media player enrols itself the first time it connects.
        </section>
      )}

      {grouped.map((group) => {
        const onlineInGroup = group.devices.filter((d: any) => d.online).length;
        return (
          <section key={group.key} className="card mb-4 p-2 md:p-4">
            <header className="mb-2 flex flex-wrap items-center justify-between gap-2 border-b border-ink-500/10 pb-2">
              <div>
                <h3 className="text-sm font-semibold">{group.label}</h3>
                <div className="text-[11px] text-ink-300">
                  {onlineInGroup} of {group.devices.length} online
                </div>
              </div>
              {group.storeId && canManage && (
                <div className="flex items-center gap-2">
                  <button
                    className="btn-ghost text-xs"
                    disabled={reinstallStore.isPending || onlineInGroup === 0}
                    title={onlineInGroup === 0
                      ? 'No online players in this store'
                      : 'Pull the latest signage agent build onto every player in this store'}
                    onClick={() => {
                      if (!confirm(`Queue a signage-reinstall on all ${group.devices.length} player(s) in "${group.label}"? Each will download the current agent build and restart.`)) return;
                      reinstallStore.mutate(group.storeId!);
                    }}
                  >
                    <Download size={12}/>Reinstall all
                  </button>
                  <button
                    className="btn-primary text-xs"
                    disabled={syncStore.isPending || onlineInGroup < 2}
                    title={onlineInGroup < 2
                      ? 'Need at least two online players in this store to sync'
                      : 'All players in this store restart playback at the same instant'}
                    onClick={() => {
                      if (!confirm(`Sync all ${group.devices.length} player(s) in "${group.label}" — every TV will restart its playlist at the same instant (~75s from now). Proceed?`)) return;
                      syncStore.mutate(group.storeId!);
                    }}
                  >
                    <Play size={12}/>Sync store
                  </button>
                </div>
              )}
            </header>

            <div className="mb-2 text-[11px] text-ink-300 md:hidden">
              ← swipe to see all columns →
            </div>
            <div className="overflow-x-auto">
            <table className="w-full min-w-[900px] text-sm">
              <thead className="bg-slate-50">
                <tr>
                  <th className="th text-left">Name</th>
                  <th className="th text-left">Brand</th>
                  <th className="th text-left">Store</th>
                  <th className="th text-left">Orientation</th>
                  <th className="th text-left">Rotation</th>
                  <th className="th text-left">Status</th>
                  <th className="th text-left">Last seen</th>
                  <th className="th text-left">Agent</th>
                  <th className="th text-right">Disk free</th>
                  <th className="th text-right">Actions</th>
                </tr>
              </thead>
              <tbody>
                {group.devices.map((d: any) => (
                  <tr key={d.id} className="border-b border-ink-500/10">
                    <td className="py-2">
                      <div className="flex items-center gap-2">
                        <span className={clsx('h-2 w-2 rounded-full', d.online ? 'bg-emerald-500' : 'bg-slate-300')} />
                        <Monitor size={14} className="text-ink-300"/>
                        {/* Always-visible brand chip so a technician can see at a
                            glance which TVs in a mixed-brand store are FF vs
                            Evolve without opening the Brand dropdown. */}
                        <EntityBadge entity={d.entity}/>
                        {renaming?.id === d.id ? (
                          <form
                            className="flex items-center gap-1"
                            onSubmit={(e) => {
                              e.preventDefault();
                              if (!renaming) return;
                              const name = renaming.draft.trim();
                              if (name && name !== d.name) update.mutate({ id: d.id, body: { name } });
                              setRenaming(null);
                            }}>
                            <input
                              autoFocus
                              className="field !py-0.5 !px-1 text-xs"
                              value={renaming?.draft ?? ''}
                              onChange={(e) => setRenaming({ id: d.id, draft: e.target.value })}
                              onKeyDown={(e) => { if (e.key === 'Escape') setRenaming(null); }}
                            />
                            <button type="submit" className="btn-ghost text-emerald-600" title="Save">
                              <Check size={12}/>
                            </button>
                            <button type="button" className="btn-ghost" onClick={() => setRenaming(null)} title="Cancel">
                              <X size={12}/>
                            </button>
                          </form>
                        ) : (
                          <>
                            <Link to={`/signage/devices/${d.id}`} className="font-medium text-brand-700 hover:underline">
                              {d.name}
                            </Link>
                            {canWrite && (
                              <button className="btn-ghost text-ink-300 hover:text-ink-100"
                                onClick={() => setRenaming({ id: d.id, draft: d.name })}
                                title="Rename">
                                <Pencil size={11}/>
                              </button>
                            )}
                          </>
                        )}
                      </div>
                    </td>
                    <td className="py-2 text-xs">
                      {canWrite ? (
                        <select className="field !py-1 text-xs" value={d.entity ?? 'FASHION_FUSION'}
                          onChange={(e) => update.mutate({ id: d.id, body: { entity: e.target.value } })}>
                          <option value="FASHION_FUSION">Fashion Fusion</option>
                          <option value="EVLV">Evolve</option>
                        </select>
                      ) : <EntityBadge entity={d.entity}/>}
                    </td>
                    <td className="py-2 text-xs">
                      {canWrite ? (
                        <select className="field !py-1 text-xs" value={d.storeId ?? ''}
                          onChange={(e) => update.mutate({ id: d.id, body: { storeId: e.target.value || null } })}>
                          <option value="">— no store —</option>
                          {stores.data?.map((s: any) => <option key={s.id} value={s.id}>{s.code} — {s.name}</option>)}
                        </select>
                      ) : (d.store ? `${d.store.code} — ${d.store.name}` : '—')}
                    </td>
                    <td className="py-2 text-xs">
                      {canWrite ? (
                        <select className="field !py-1 text-xs" value={d.orientation ?? 'LANDSCAPE'}
                          onChange={(e) => update.mutate({ id: d.id, body: { orientation: e.target.value } })}
                          title="Content filter — portrait devices only receive portrait videos (plus BOTH)">
                          <option value="LANDSCAPE">Landscape</option>
                          <option value="PORTRAIT">Portrait</option>
                        </select>
                      ) : (
                        <span>{d.orientation}</span>
                      )}
                    </td>
                    <td className="py-2 text-xs">
                      {canWrite ? (
                        <select
                          className="field !py-1 text-xs"
                          value={String(d.rotation ?? 0)}
                          onChange={(e) => update.mutate({ id: d.id, body: { rotation: Number(e.target.value) } })}
                          title="Screen rotation in degrees — changes take effect on the next device poll (~60s). Matches physical mount angle, clockwise.">
                          <option value="0">0° (normal)</option>
                          <option value="90">90° CW</option>
                          <option value="180">180° (upside-down)</option>
                          <option value="270">270° CW</option>
                        </select>
                      ) : (
                        <span className="font-mono">{Number(d.rotation ?? 0)}°</span>
                      )}
                    </td>
                    <td className="py-2 text-xs">
                      <span className={clsx(
                        'rounded px-1.5 py-0.5 font-mono text-[10px]',
                        d.status === 'ACTIVE'   && 'bg-emerald-100 text-emerald-700',
                        d.status === 'PENDING'  && 'bg-amber-100 text-amber-700',
                        d.status === 'DISABLED' && 'bg-slate-100 text-slate-500',
                      )}>{d.status}</span>
                    </td>
                    <td className="py-2 text-xs text-ink-300">
                      {d.lastSeenAt ? new Date(d.lastSeenAt).toLocaleString() : 'never'}
                    </td>
                    <td className="py-2 text-xs">{d.agentVersion ?? '—'}</td>
                    <td className="py-2 text-right text-xs">
                      {d.diskFreePct != null ? `${d.diskFreePct}%` : '—'}
                    </td>
                    <td className="py-2 text-right">
                      <div className="flex justify-end gap-1">
                        {canWrite && d.status === 'PENDING' && (
                          <button className="btn-ghost text-emerald-600" onClick={() => update.mutate({ id: d.id, body: { status: 'ACTIVE' } })}>
                            Approve
                          </button>
                        )}
                        <button className="btn-ghost" title="See what's playing now"
                          onClick={() => setViewing(d)}>
                          <Eye size={12}/>View
                        </button>
                        {canWrite && (
                          <button className="btn-ghost" title="Force the agent to purge its cache and re-download"
                            onClick={() => { if (confirm('Force resync?')) resync.mutate(d.id); }}>
                            <RefreshCw size={12}/>
                          </button>
                        )}
                        {canWrite && (
                          <button className="btn-ghost text-rose-600 hover:text-rose-700"
                            title="Delete this device from the fleet (irreversible)"
                            onClick={() => {
                              if (!confirm(
                                `Delete "${d.name}" from the fleet?\n\n` +
                                `This removes the device record and its command history. ` +
                                `If the physical box is still powered on and online, ` +
                                `it will re-enrol itself on its next heartbeat.`,
                              )) return;
                              removeDevice.mutate(d.id);
                            }}>
                            <Trash2 size={12}/>
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            </div>
          </section>
        );
      })}

      {viewing && <PeekModal device={viewing} onClose={() => setViewing(null)} />}
      {showInstaller && <InstallerModal onClose={() => setShowInstaller(false)} stores={stores.data ?? []} />}
    </>
  );
}

// =========================================================================
//  InstallerModal — generates the one-line curl|bash the technician runs
//  on a freshly-imaged signage box. Everything the installer needs lives in
//  the URL query string (platform / entity / store code / display name), so
//  copy-paste is all the technician has to do.
// =========================================================================
function InstallerModal({ onClose, stores }: { onClose: () => void; stores: any[] }) {
  const [platform, setPlatform] = useState<'ubuntu-console' | 'ubuntu-desktop' | 'pi'>('ubuntu-console');
  const [entity, setEntity] = useState<'FASHION_FUSION' | 'EVLV'>('FASHION_FUSION');
  const [name, setName] = useState('');
  const [storeCode, setStoreCode] = useState('');
  const [migrate, setMigrate] = useState(false);

  // The API base the web app was built against. The installer needs an
  // absolute URL so the installer script knows where to phone home — fall
  // back to window.location.origin + /api/v1 for self-hosted deployments.
  const base = (import.meta.env.VITE_API_BASE_URL as string | undefined)
    ?? `${window.location.origin}/api/v1`;

  const params = new URLSearchParams({ platform, entity });
  if (name.trim())      params.set('name', name.trim());
  if (storeCode.trim()) params.set('storeCode', storeCode.trim());
  if (migrate)          params.set('migrate', '1');
  const url = `${base}/signage/installer.sh?${params.toString()}`;
  const oneLiner = `curl -fsSL "${url}" | sudo bash`;

  const copy = () => {
    navigator.clipboard?.writeText(oneLiner).then(
      () => alert('Copied to clipboard — paste into the device terminal'),
      () => alert('Copy failed — select the text and copy manually'),
    );
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onClick={onClose}>
      <div className="w-full max-w-2xl rounded-lg bg-white shadow-xl"
        onClick={(e) => e.stopPropagation()}>
        <header className="flex items-center justify-between border-b border-ink-500/10 p-4">
          <h3 className="text-sm font-semibold">Install signage agent on a new device</h3>
          <button className="btn-ghost" onClick={onClose}><X size={14}/></button>
        </header>
        <div className="space-y-3 p-4 text-sm">
          <p className="text-xs text-ink-300">
            Fill the fields that apply, SSH into the freshly-imaged box, then paste the command below.
            The installer handles apt packages, agent code, systemd unit, and auto-enrols the device.
            Blank fields default to sensible values; the display name defaults to the machine's hostname.
          </p>
          <div className="grid grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium">Platform</span>
              <select className="field mt-1 w-full" value={platform}
                onChange={(e) => setPlatform(e.target.value as any)}>
                <option value="ubuntu-console">Ubuntu Server (console) — mpv on DRM/KMS</option>
                <option value="ubuntu-desktop">Ubuntu Desktop — mpv on X11</option>
                <option value="pi">Raspberry Pi OS</option>
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium">Brand</span>
              <select className="field mt-1 w-full" value={entity}
                onChange={(e) => setEntity(e.target.value as any)}>
                <option value="FASHION_FUSION">Fashion Fusion</option>
                <option value="EVLV">Evolve</option>
              </select>
            </label>
            <label className="block">
              <span className="text-xs font-medium">Display name <span className="text-ink-300">(optional)</span></span>
              <input className="field mt-1 w-full" value={name} onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Atterbury - Window TV"/>
            </label>
            <label className="block">
              <span className="text-xs font-medium">Store code <span className="text-ink-300">(optional)</span></span>
              <select className="field mt-1 w-full" value={storeCode}
                onChange={(e) => setStoreCode(e.target.value)}>
                <option value="">— assign later —</option>
                {stores.map((s: any) => <option key={s.id} value={s.code}>{s.code} — {s.name}</option>)}
              </select>
            </label>
          </div>

          <label className="flex items-start gap-2 rounded border border-amber-200 bg-amber-50 p-2 text-xs">
            <input type="checkbox" className="mt-0.5"
              checked={migrate} onChange={(e) => setMigrate(e.target.checked)}/>
            <span>
              <b>Migrate from an older signage install</b> — stops and removes a prior
              <code className="mx-1 rounded bg-white px-1">video_player</code>-style
              service, scrubs <code className="mx-1 rounded bg-white px-1">install_video_player*.sh</code>,
              <code className="mx-1 rounded bg-white px-1">play.sh</code> and friends from the player home,
              then runs the fresh install. Safe no-op on a clean box.
            </span>
          </label>

          <div>
            <div className="mb-1 flex items-center justify-between">
              <span className="text-xs font-medium">Run this on the new device:</span>
              <button className="btn-ghost text-xs" onClick={copy}>
                <Download size={12}/>Copy
              </button>
            </div>
            <pre className="overflow-x-auto rounded bg-slate-900 p-3 text-[11px] leading-5 text-emerald-300">
{oneLiner}
            </pre>
            <p className="mt-2 text-[11px] text-ink-300">
              First run takes 3–5 minutes (apt packages, VAAPI driver, venv). When it finishes the device
              auto-enrols in <b>PENDING</b> status — approve it from this page.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}

export function EntityBadge({ entity }: { entity?: string }) {
  const map: Record<string, { label: string; cls: string }> = {
    FASHION_FUSION: { label: 'FF',    cls: 'bg-brand-50 text-brand-700 ring-brand-300' },
    EVLV:           { label: 'EVLV',  cls: 'bg-indigo-50 text-indigo-700 ring-indigo-300' },
    BOTH:           { label: 'Both',  cls: 'bg-slate-100 text-slate-700 ring-slate-300' },
  };
  const info = map[entity ?? 'FASHION_FUSION'] ?? map.FASHION_FUSION;
  return <span className={clsx('rounded px-1.5 py-0.5 text-[10px] font-semibold ring-1', info.cls)}>{info.label}</span>;
}

// =========================================================================
//  PeekModal — ask the agent for a snapshot and show it, auto-refreshing
// =========================================================================
function PeekModal({ device, onClose }: { device: any; onClose: () => void }) {
  const [autoRefresh, setAutoRefresh] = useState(true);
  const [lastRequestedAt, setLastRequestedAt] = useState<number>(0);

  const snap = useQuery({
    queryKey: ['signage-snapshot', device.id],
    queryFn: () => api.get(`/signage/devices/${device.id}/snapshot`).then((r) => r.data),
    refetchInterval: 2_000,
  });

  const request = useMutation({
    mutationFn: () => api.post(`/signage/devices/${device.id}/snapshot`).then((r) => r.data),
    onSuccess: () => setLastRequestedAt(Date.now()),
  });

  // Trigger a new snapshot every ~6s while the modal is open and auto-refresh on
  useEffect(() => {
    if (!autoRefresh) return;
    request.mutate();
    const t = setInterval(() => request.mutate(), 6_000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoRefresh, device.id]);

  const snapAge = snap.data?.snapshotAt
    ? Math.round((Date.now() - new Date(snap.data.snapshotAt).getTime()) / 1000)
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4" onClick={onClose}>
      <div className="relative max-h-[90vh] max-w-5xl overflow-hidden rounded-lg bg-slate-900 shadow-2xl"
        onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between gap-3 border-b border-slate-700 bg-slate-800 px-4 py-2">
          <div>
            <div className="text-sm font-semibold text-white">{device.name}</div>
            <div className="text-[11px] text-slate-400">
              {device.online ? 'Online' : 'Offline'} ·
              {snap.data?.pending && ' Capturing…'}
              {snapAge !== null && !snap.data?.pending && ` Snapshot ${snapAge}s ago`}
            </div>
          </div>
          <div className="flex items-center gap-2">
            <label className="flex items-center gap-1 text-[11px] text-slate-200">
              <input type="checkbox" checked={autoRefresh} onChange={(e) => setAutoRefresh(e.target.checked)}/>
              Auto-refresh
            </label>
            <button className="btn-ghost text-slate-100 hover:text-white"
              disabled={request.isPending}
              onClick={() => request.mutate()}>
              <RefreshCw size={12}/>Refresh
            </button>
            <button className="btn-ghost text-slate-100 hover:text-white" onClick={onClose}>
              <X size={14}/>
            </button>
          </div>
        </div>

        <div className="flex min-h-[320px] items-center justify-center bg-black">
          {snap.data?.url ? (
            <img src={snap.data.url} alt="Current screen" className="max-h-[80vh] max-w-full object-contain" />
          ) : snap.data?.pending ? (
            <div className="p-8 text-center text-sm text-slate-300">
              <div className="animate-pulse">Waiting for the player to capture…</div>
              <div className="mt-2 text-[11px] text-slate-500">Takes a few seconds — the agent only checks the server every 30s or so.</div>
            </div>
          ) : (
            <div className="p-8 text-center text-sm text-slate-400">
              No snapshot yet. Click Refresh to request one.
            </div>
          )}
        </div>

        {!device.online && (
          <div className="bg-rose-950/60 px-4 py-2 text-xs text-rose-200">
            This player is offline — snapshots won't update until it reconnects.
          </div>
        )}
      </div>
    </div>
  );
}
