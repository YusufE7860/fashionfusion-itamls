import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { PageHeader } from '@/components/PageHeader';
import { ChevronDown, ChevronRight, Plus, KeyRound, Power, Store as StoreIcon, RotateCcw, X } from 'lucide-react';
import clsx from 'clsx';

/**
 * Permissions grouped by module. Each permission has a friendly label so the
 * UI reads like plain English instead of permission codes.
 */
type Perm = { code: string; label: string };
type ModuleGroup = { label: string; icon?: string; perms: Perm[] };

const MODULE_GROUPS: ModuleGroup[] = [
  { label: 'Admin & security', perms: [
    { code: 'users:manage',         label: 'Manage users and roles' },
    { code: 'roles:manage',         label: 'Edit role definitions' },
    { code: 'auditlog:read',        label: 'View audit log' },
    { code: 'store:access:manage',  label: 'Set per-user store access' },
  ]},
  { label: 'Catalog & SKUs', perms: [
    { code: 'catalog:read',  label: 'View catalog (SKUs, suppliers)' },
    { code: 'catalog:write', label: 'Add/edit SKUs' },
  ]},
  { label: 'Assets', perms: [
    { code: 'assets:read',    label: 'View assets' },
    { code: 'assets:write',   label: 'Add/edit assets' },
    { code: 'assets:move',    label: 'Move assets between locations' },
    { code: 'assets:dispose', label: 'Dispose / write off assets' },
  ]},
  { label: 'Stock', perms: [
    { code: 'stock:read',  label: 'View stock levels' },
    { code: 'stock:write', label: 'Adjust stock' },
  ]},
  { label: 'GRV (goods received)', perms: [
    { code: 'grv:create',  label: 'Capture GRVs' },
    { code: 'grv:confirm', label: 'Confirm / post GRVs' },
  ]},
  { label: 'IBT (branch transfers)', perms: [
    { code: 'ibt:create',   label: 'Request transfers' },
    { code: 'ibt:approve',  label: 'Approve transfers' },
    { code: 'ibt:dispatch', label: 'Dispatch transfers' },
    { code: 'ibt:receive',  label: 'Receive transfers' },
  ]},
  { label: 'Procurement', perms: [
    { code: 'procurement:create',           label: 'Raise purchase requests' },
    { code: 'procurement:approve:it',       label: 'IT approval of purchases' },
    { code: 'procurement:approve:finance',  label: 'Finance approval of purchases' },
    { code: 'suppliers:manage',             label: 'Manage suppliers' },
  ]},
  { label: 'Repairs & warranties', perms: [
    { code: 'repairs:read',    label: 'View repairs' },
    { code: 'repairs:write',   label: 'Log and update repairs' },
    { code: 'warranties:read', label: 'View warranty dashboard' },
  ]},
  { label: 'Stores', perms: [
    { code: 'stores:read',   label: 'View stores' },
    { code: 'stores:write',  label: 'Add / edit stores' },
    { code: 'store:wizard',  label: 'Run new-store wizard' },
    { code: 'stores:audit',  label: 'Audit stores' },
  ]},
  { label: 'HQ & departments', perms: [
    { code: 'departments:read',  label: 'View HQ departments' },
    { code: 'departments:write', label: 'Manage HQ departments' },
  ]},
  { label: 'Helpdesk', perms: [
    { code: 'tickets:read',              label: 'View tickets assigned to me / my store' },
    { code: 'tickets:read:all',          label: 'View ALL tickets (not just mine)' },
    { code: 'tickets:write',             label: 'Log and comment on tickets' },
    { code: 'tickets:assign',            label: 'Assign tickets and change priority' },
    { code: 'tickets:reports',           label: 'View helpdesk reports' },
    { code: 'tickets:manage:categories', label: 'Manage categories & SLA policies' },
    { code: 'tickets:manage:webhooks',   label: 'Manage outbound webhooks' },
  ]},
  { label: 'DVRs & CCTV', perms: [
    { code: 'dvrs:read',  label: 'View DVRs & live snapshots' },
    { code: 'dvrs:write', label: 'Add / edit DVRs' },
  ]},
  { label: 'PIN pads', perms: [
    { code: 'pinpads:read',  label: 'View PIN pads' },
    { code: 'pinpads:write', label: 'Dispatch / confirm / return PIN pads' },
  ]},
  { label: 'MikroTik generator', perms: [
    { code: 'mikrotik:read',  label: 'View generated configs' },
    { code: 'mikrotik:write', label: 'Generate / edit MikroTik configs' },
  ]},
  { label: 'PC agents', perms: [
    { code: 'agents:read',  label: 'View enrolled PCs' },
    { code: 'agents:write', label: 'Manage enrolment tokens / PCs' },
  ]},
  { label: 'Reports (global)', perms: [
    { code: 'reports:read',   label: 'View reports' },
    { code: 'reports:export', label: 'Export reports (CSV/PDF)' },
  ]},
];

export function Users() {
  const qc = useQueryClient();
  const users = useQuery({ queryKey: ['users'], queryFn: () => api.get('/users').then((r) => r.data) });
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => api.get('/roles').then((r) => r.data) });
  const stores = useQuery({ queryKey: ['stores'], queryFn: () => api.get('/stores').then((r) => r.data) });
  const [openId, setOpenId] = useState<string | null>(null);

  const [showNew, setShowNew] = useState(false);
  const [form, setForm] = useState({ email: '', fullName: '', password: '', roleId: '', storeId: '' });
  const create = useMutation({
    mutationFn: () => api.post('/users', {
      email: form.email, fullName: form.fullName, password: form.password,
      roleId: form.roleId, storeId: form.storeId || null,
    }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      setShowNew(false);
      setForm({ email: '', fullName: '', password: '', roleId: '', storeId: '' });
    },
    onError: (e: any) => alert(e.response?.data?.message ?? 'Could not create user'),
  });

  const roleNeedsStore = (roleCode?: string) => roleCode === 'STORE_MANAGER';
  const selectedRoleCode = roles.data?.find((r: any) => r.id === form.roleId)?.code;

  return (
    <>
      <PageHeader
        title="Users & Access"
        subtitle="Manage who can use the system and what each user can see"
        actions={<button className="btn-primary" onClick={() => setShowNew(!showNew)}>
          {showNew ? <><X size={14}/>Cancel</> : <><Plus size={14}/>New user</>}
        </button>}
      />

      {showNew && (
        <div className="card mb-4 p-4">
          <h3 className="mb-3 text-sm font-semibold text-ink-50">Create user</h3>
          <div className="grid grid-cols-2 gap-3">
            <div><label className="label">Full name</label>
              <input className="field" value={form.fullName}
                     onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                     placeholder="Jane Doe" /></div>
            <div><label className="label">Email</label>
              <input type="email" className="field" value={form.email}
                     onChange={(e) => setForm({ ...form, email: e.target.value })}
                     placeholder="jane.doe@fashionfusion.local" /></div>
            <div><label className="label">Initial password (≥ 8 chars)</label>
              <input type="text" className="field font-mono" value={form.password}
                     onChange={(e) => setForm({ ...form, password: e.target.value })}
                     placeholder="TempPassword123" />
              <p className="mt-1 text-[11px] text-ink-400">User should change on first login.</p></div>
            <div><label className="label">Role</label>
              <select className="field" value={form.roleId}
                      onChange={(e) => setForm({ ...form, roleId: e.target.value, storeId: '' })}>
                <option value="">Pick a role…</option>
                {roles.data?.map((r: any) => (
                  <option key={r.id} value={r.id}>{r.code.replaceAll('_',' ')}</option>
                ))}
              </select></div>
            {roleNeedsStore(selectedRoleCode) && (
              <div className="col-span-2"><label className="label">Assigned store (required for Store Manager)</label>
                <select className="field" value={form.storeId}
                        onChange={(e) => setForm({ ...form, storeId: e.target.value })}>
                  <option value="">Pick a store…</option>
                  {stores.data?.map((s: any) => (
                    <option key={s.id} value={s.id}>{s.code} – {s.name}</option>
                  ))}
                </select></div>
            )}
          </div>
          <button className="btn-primary mt-4"
                  disabled={!form.email || !form.fullName || form.password.length < 8 || !form.roleId ||
                            (roleNeedsStore(selectedRoleCode) && !form.storeId) || create.isPending}
                  onClick={() => create.mutate()}>
            {create.isPending ? 'Creating…' : 'Create user'}
          </button>
        </div>
      )}

      <div className="space-y-3">
        {users.data?.map((u: any) => (
          <UserCard
            key={u.id}
            user={u}
            roles={roles.data ?? []}
            open={openId === u.id}
            onToggle={() => setOpenId(openId === u.id ? null : u.id)}
          />
        ))}
      </div>
    </>
  );
}

function UserCard({ user, roles, open, onToggle }: { user: any; roles: any[]; open: boolean; onToggle: () => void }) {
  const qc = useQueryClient();
  const [showStoreAccess, setShowStoreAccess] = useState(false);
  const detail = useQuery({
    queryKey: ['user', user.id, 'detail'],
    queryFn: () => api.get(`/users/${user.id}`).then((r) => r.data),
    enabled: open,
  });
  // Permissions actually seeded in the DB — used to filter MODULE_GROUPS so
  // we don't show checkboxes for codes the backend won't accept.
  const allPerms = useQuery({
    queryKey: ['perms-list'],
    queryFn: () => api.get('/permissions').then((r) => r.data as Array<{ code: string }>),
    enabled: open,
    staleTime: 5 * 60_000,
  });
  const knownPerms = useMemo(
    () => new Set((allPerms.data ?? []).map((p) => p.code)),
    [allPerms.data],
  );
  const visibleGroups = useMemo(
    () => MODULE_GROUPS
      .map((g) => ({ ...g, perms: g.perms.filter((p) => knownPerms.has(p.code)) }))
      .filter((g) => g.perms.length > 0),
    [knownPerms],
  );

  const updateRole = useMutation({
    mutationFn: (roleId: string) => api.patch(`/users/${user.id}/role`, { roleId }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      qc.invalidateQueries({ queryKey: ['user', user.id, 'detail'] });
    },
  });

  const toggleActive = useMutation({
    mutationFn: () => api.patch(`/users/${user.id}/active`, { isActive: !user.isActive }).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['users'] }),
  });

  const resetPassword = useMutation({
    mutationFn: (password: string) => api.post(`/users/${user.id}/reset-password`, { password }).then((r) => r.data),
    onSuccess: () => alert('Password reset. Give the user the new password and ask them to change it on next login.'),
    onError: (e: any) => alert(e.response?.data?.message ?? 'Reset failed'),
  });

  const setOverride = useMutation({
    mutationFn: (body: { permissionCode: string; effect: 'GRANT' | 'DENY' | 'INHERIT' }) =>
      api.post(`/users/${user.id}/permissions`, body).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['user', user.id, 'detail'] }),
  });

  // Build effective view
  const view = useMemo(() => {
    if (!detail.data) return null;
    const rolePerms = new Set(detail.data.role.permissions.map((rp: any) => rp.permission.code));
    const overrides = new Map<string, 'GRANT' | 'DENY'>();
    for (const o of detail.data.permissionOverrides) {
      overrides.set(o.permission.code, o.effect);
    }
    return { rolePerms, overrides };
  }, [detail.data]);

  function effectOf(code: string): 'INHERIT' | 'GRANT' | 'DENY' {
    return view?.overrides.get(code) ?? 'INHERIT';
  }
  function isEffective(code: string): boolean {
    const ovr = view?.overrides.get(code);
    if (ovr === 'GRANT') return true;
    if (ovr === 'DENY') return false;
    return view?.rolePerms.has(code) ?? false;
  }

  return (
    <div className="card overflow-hidden">
      <button className="flex w-full items-center justify-between px-4 py-3 text-left" onClick={onToggle}>
        <div className="flex items-center gap-3">
          {open ? <ChevronDown size={16}/> : <ChevronRight size={16}/>}
          <div className="grid h-9 w-9 place-items-center rounded-full bg-gradient-to-br from-brand-400 to-brand-600 text-xs font-bold text-white">
            {user.fullName.split(' ').map((p: string) => p[0]).slice(0,2).join('')}
          </div>
          <div>
            <div className="font-semibold text-white">{user.fullName}</div>
            <div className="text-xs text-ink-200">{user.email}</div>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <span className="pill-brand">{user.role?.code?.replaceAll('_',' ')}</span>
          {user.permissionOverrides?.length > 0 && (
            <span className="pill-gold">{user.permissionOverrides.length} override(s)</span>
          )}
          {!user.isActive && <span className="pill-red">Disabled</span>}
        </div>
      </button>

      {open && (
        <div className="border-t border-ink-500/40 p-4">
          {!detail.data ? (
            <div className="text-sm text-ink-200">Loading…</div>
          ) : (
            <>
              <div className="mb-4 flex flex-wrap items-end gap-3">
                <div className="flex-1 min-w-[220px]">
                  <label className="label">Role</label>
                  <select className="field max-w-xs" value={detail.data.role.id}
                          onChange={(e) => updateRole.mutate(e.target.value)}>
                    {roles.map((r: any) => <option key={r.id} value={r.id}>{r.code.replaceAll('_',' ')}</option>)}
                  </select>
                </div>
                {detail.data.role.code === 'AREA_MANAGER' && (
                  <AreaManagerTechPicker user={detail.data} allUsers={roles /* unused — see component */} />
                )}
                <button className="btn-ghost"
                        onClick={() => {
                          const pw = prompt('New password (≥ 8 characters):');
                          if (pw && pw.length >= 8) resetPassword.mutate(pw);
                          else if (pw !== null) alert('Password must be at least 8 characters');
                        }}>
                  <KeyRound size={12}/>Reset password
                </button>
                <button className="btn-ghost"
                        onClick={() => {
                          if (confirm(user.isActive ? 'Disable this user? They will not be able to sign in.' : 'Re-enable this user?'))
                            toggleActive.mutate();
                        }}>
                  <Power size={12}/>{user.isActive ? 'Disable user' : 'Enable user'}
                </button>
                <button className="btn-ghost" onClick={() => setShowStoreAccess(true)}>
                  <StoreIcon size={12}/>Store access
                </button>
                <p className="w-full text-xs text-ink-300">
                  Changing role replaces the inherited permission set. Per-permission overrides still apply on top.
                </p>
              </div>

              <div className="mb-3 flex items-center justify-between">
                <h4 className="text-[11px] font-bold uppercase tracking-wider text-ink-200">Module access</h4>
                <p className="text-[11px] text-ink-300">
                  Tick a box to grant access, untick to deny. Yellow = different from role default.
                </p>
              </div>

              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                {visibleGroups.map((g) => {
                  // Compute module-level master state so you can see at a glance
                  const allOn = g.perms.every((p) => isEffective(p.code));
                  const allOff = g.perms.every((p) => !isEffective(p.code));
                  const moduleState: 'all' | 'none' | 'some' = allOn ? 'all' : allOff ? 'none' : 'some';
                  const anyOverride = g.perms.some((p) => effectOf(p.code) !== 'INHERIT');

                  return (
                    <div key={g.label} className="rounded-lg border border-ink-500/40 bg-ink-700/30 p-3">
                      <div className="mb-2 flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <span className="text-[12px] font-bold text-brand-300">{g.label}</span>
                          <span className={clsx(
                            'rounded px-1.5 py-0.5 text-[9px] font-semibold uppercase',
                            moduleState === 'all'  && 'bg-emerald-500/15 text-emerald-300',
                            moduleState === 'some' && 'bg-amber-500/15 text-amber-300',
                            moduleState === 'none' && 'bg-ink-700/60 text-ink-300',
                          )}>
                            {moduleState === 'all' ? 'Full' : moduleState === 'some' ? 'Partial' : 'None'}
                          </span>
                        </div>
                        <div className="flex items-center gap-1">
                          <button
                            type="button"
                            className="text-[10px] text-brand-300 hover:underline"
                            onClick={() => {
                              for (const p of g.perms) {
                                if (!isEffective(p.code)) setOverride.mutate({ permissionCode: p.code, effect: 'GRANT' });
                              }
                            }}
                          >
                            All
                          </button>
                          <span className="text-ink-500">·</span>
                          <button
                            type="button"
                            className="text-[10px] text-ink-300 hover:underline"
                            onClick={() => {
                              for (const p of g.perms) {
                                if (isEffective(p.code)) setOverride.mutate({ permissionCode: p.code, effect: 'DENY' });
                              }
                            }}
                          >
                            None
                          </button>
                          {anyOverride && (
                            <>
                              <span className="text-ink-500">·</span>
                              <button
                                type="button"
                                className="flex items-center gap-0.5 text-[10px] text-amber-300 hover:underline"
                                title="Clear per-user overrides on this module and inherit from role"
                                onClick={() => {
                                  for (const p of g.perms) {
                                    if (effectOf(p.code) !== 'INHERIT') setOverride.mutate({ permissionCode: p.code, effect: 'INHERIT' });
                                  }
                                }}
                              >
                                <RotateCcw size={9}/>Reset
                              </button>
                            </>
                          )}
                        </div>
                      </div>

                      <ul className="space-y-1.5">
                        {g.perms.map((p) => {
                          const eff = effectOf(p.code);
                          const active = isEffective(p.code);
                          const roleHas = view?.rolePerms.has(p.code) ?? false;
                          const differsFromRole = active !== roleHas;
                          return (
                            <li key={p.code}>
                              <label className="group flex cursor-pointer items-start gap-2 rounded px-1.5 py-1 hover:bg-ink-700/40">
                                <input
                                  type="checkbox"
                                  className="mt-0.5 h-4 w-4 shrink-0 cursor-pointer accent-brand-500"
                                  checked={active}
                                  onChange={(e) => {
                                    const want = e.target.checked;
                                    const next: 'INHERIT' | 'GRANT' | 'DENY' =
                                      // If the role default already matches what we want, clear the override
                                      want === roleHas ? 'INHERIT' : (want ? 'GRANT' : 'DENY');
                                    setOverride.mutate({ permissionCode: p.code, effect: next });
                                  }}
                                />
                                <span className="flex-1">
                                  <span className={clsx(
                                    'text-xs',
                                    active ? 'text-ink-50' : 'text-ink-300 line-through',
                                    differsFromRole && 'text-amber-200',
                                  )}>
                                    {p.label}
                                  </span>
                                  {differsFromRole && (
                                    <span className="ml-1.5 text-[9px] text-amber-400">
                                      (overridden)
                                    </span>
                                  )}
                                </span>
                              </label>
                            </li>
                          );
                        })}
                      </ul>
                    </div>
                  );
                })}
              </div>

              <p className="mt-4 text-[11px] text-ink-200">
                Changes apply immediately. The user must sign out and back in for their menu and access to refresh.
              </p>
            </>
          )}
        </div>
      )}

      {showStoreAccess && (
        <StoreAccessModal
          userId={user.id}
          userName={user.fullName}
          onClose={() => setShowStoreAccess(false)}
        />
      )}
    </div>
  );
}

// ---------- Area Manager → Technician assignment ----------
function AreaManagerTechPicker({ user }: { user: any; allUsers: any }) {
  const qc = useQueryClient();
  // Fetch all users and keep only Technicians / Administrators (anyone who can own tickets)
  const all = useQuery({ queryKey: ['users'], queryFn: () => api.get('/users').then((r) => r.data) });
  const techs = useMemo(() => (all.data ?? []).filter((u: any) =>
    u.isActive && ['ADMINISTRATOR', 'IT_MANAGER', 'TECHNICIAN'].includes(u.role?.code)
  ), [all.data]);

  const update = useMutation({
    mutationFn: (techId: string | null) =>
      api.patch(`/users/${user.id}`, { managedByTechId: techId }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      qc.invalidateQueries({ queryKey: ['user', user.id, 'detail'] });
    },
  });

  return (
    <div className="min-w-[260px]">
      <label className="label">Reports to (technician)</label>
      <select className="field max-w-xs" value={user.managedByTechId ?? ''}
        onChange={(e) => update.mutate(e.target.value || null)}>
        <option value="">— unassigned —</option>
        {techs.map((t: any) => (
          <option key={t.id} value={t.id}>{t.fullName} ({t.role?.code})</option>
        ))}
      </select>
      <p className="mt-1 text-[11px] text-ink-300">
        Tickets logged for this AM's stores auto-route to this tech. Use <b>Store access</b> to pick which stores the AM covers.
      </p>
    </div>
  );
}

// ---------- Per-user store access ----------
function StoreAccessModal({ userId, userName, onClose }: { userId: string; userName: string; onClose: () => void }) {
  const qc = useQueryClient();
  const stores = useQuery({ queryKey: ['stores'], queryFn: () => api.get('/stores').then((r) => r.data) });
  const access = useQuery({
    queryKey: ['user', userId, 'store-access'],
    queryFn: () => api.get(`/users/${userId}/store-access`).then((r) => r.data as Array<{ id: string }>),
  });

  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [q, setQ] = useState('');

  useMemo(() => {
    if (access.data) setSelected(new Set(access.data.map((s) => s.id)));
  }, [access.data]);

  const save = useMutation({
    mutationFn: () => api.post(`/users/${userId}/store-access`, { storeIds: [...selected] }).then((r) => r.data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['user', userId, 'store-access'] }); onClose(); },
  });

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return (stores.data ?? []).filter((s: any) =>
      !needle ||
      s.code.toLowerCase().includes(needle) ||
      s.name.toLowerCase().includes(needle) ||
      (s.region ?? '').toLowerCase().includes(needle),
    );
  }, [stores.data, q]);

  const byRegion = useMemo(() => {
    const map = new Map<string, any[]>();
    for (const s of filtered) {
      const key = s.region ?? '—';
      const list = map.get(key) ?? [];
      list.push(s); map.set(key, list);
    }
    return [...map.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  }, [filtered]);

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id); else next.add(id);
    setSelected(next);
  }
  function selectRegion(list: any[], on: boolean) {
    const next = new Set(selected);
    for (const s of list) on ? next.add(s.id) : next.delete(s.id);
    setSelected(next);
  }

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/60 p-4">
      <div className="flex max-h-[90vh] w-full max-w-3xl flex-col rounded-xl bg-white p-4 shadow-2xl">
        <div className="mb-3 flex items-start justify-between">
          <div>
            <h3 className="text-base font-semibold text-ink-50">Store access — {userName}</h3>
            <p className="mt-1 text-xs text-ink-300">
              Tick the stores this user should see (DVRs, and future store-scoped views). Administrators + IT Managers see everything regardless of this list.
            </p>
          </div>
          <button className="btn-ghost" onClick={onClose}><X size={13} /></button>
        </div>

        <div className="mb-2 flex items-center gap-2">
          <input className="field flex-1" placeholder="Search stores…" value={q}
            onChange={(e) => setQ(e.target.value)} />
          <span className="text-xs text-ink-300">{selected.size} selected</span>
        </div>

        <div className="mb-3 flex-1 overflow-y-auto">
          {byRegion.map(([region, list]) => {
            const allSelected = list.every((s) => selected.has(s.id));
            return (
              <div key={region} className="mb-3">
                <div className="mb-1 flex items-center justify-between border-b border-ink-500/40 pb-1">
                  <div className="text-[11px] font-semibold uppercase tracking-wider text-ink-300">{region} ({list.length})</div>
                  <button className="text-[11px] text-brand-600 hover:underline"
                    onClick={() => selectRegion(list, !allSelected)}>
                    {allSelected ? 'Deselect region' : 'Select all in region'}
                  </button>
                </div>
                <div className="grid grid-cols-2 gap-x-3 gap-y-1 md:grid-cols-3">
                  {list.map((s) => (
                    <label key={s.id} className="flex items-center gap-2 rounded px-2 py-1 text-xs hover:bg-slate-50">
                      <input type="checkbox" checked={selected.has(s.id)} onChange={() => toggle(s.id)} />
                      <span className="font-mono text-ink-300">{s.code}</span>
                      <span className="truncate">{s.name}</span>
                    </label>
                  ))}
                </div>
              </div>
            );
          })}
          {byRegion.length === 0 && (
            <div className="py-4 text-center text-xs text-ink-300">No stores match.</div>
          )}
        </div>

        <div className="flex items-center justify-end gap-2 border-t border-ink-500/40 pt-3">
          <button className="btn-ghost" onClick={onClose}>Cancel</button>
          <button className="btn-primary" disabled={save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? 'Saving…' : 'Save access'}
          </button>
        </div>
      </div>
    </div>
  );
}
