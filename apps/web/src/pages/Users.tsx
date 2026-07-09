import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { PageHeader } from '@/components/PageHeader';
import { ChevronDown, ChevronRight, Check, X, Minus } from 'lucide-react';
import clsx from 'clsx';

// Modules group the granular permissions for the UI
const MODULE_GROUPS: { label: string; perms: string[] }[] = [
  { label: 'Admin',            perms: ['users:manage', 'roles:manage', 'auditlog:read'] },
  { label: 'Catalog',          perms: ['catalog:read', 'catalog:write'] },
  { label: 'Assets',           perms: ['assets:read', 'assets:write', 'assets:move', 'assets:dispose'] },
  { label: 'Stock',            perms: ['stock:read', 'stock:write'] },
  { label: 'GRV',              perms: ['grv:create', 'grv:confirm'] },
  { label: 'IBT',              perms: ['ibt:create', 'ibt:approve', 'ibt:dispatch', 'ibt:receive'] },
  { label: 'Procurement',      perms: ['procurement:create', 'procurement:approve:it', 'procurement:approve:finance', 'suppliers:manage'] },
  { label: 'Service',          perms: ['repairs:read', 'repairs:write', 'warranties:read'] },
  { label: 'Stores',           perms: ['stores:read', 'stores:write', 'store:wizard', 'stores:audit'] },
  { label: 'Reports',          perms: ['reports:read', 'reports:export'] },
];

export function Users() {
  const users = useQuery({ queryKey: ['users'], queryFn: () => api.get('/users').then((r) => r.data) });
  const roles = useQuery({ queryKey: ['roles'], queryFn: () => api.get('/roles').then((r) => r.data) });
  const [openId, setOpenId] = useState<string | null>(null);

  return (
    <>
      <PageHeader title="Users & Access" subtitle="Manage who can use the system and what each user can see" />
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
  const detail = useQuery({
    queryKey: ['user', user.id, 'detail'],
    queryFn: () => api.get(`/users/${user.id}`).then((r) => r.data),
    enabled: open,
  });

  const updateRole = useMutation({
    mutationFn: (roleId: string) => api.patch(`/users/${user.id}/role`, { roleId }).then((r) => r.data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['users'] });
      qc.invalidateQueries({ queryKey: ['user', user.id, 'detail'] });
    },
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
        </div>
      </button>

      {open && (
        <div className="border-t border-ink-500/40 p-4">
          {!detail.data ? (
            <div className="text-sm text-ink-200">Loading…</div>
          ) : (
            <>
              <div className="mb-4 flex items-end gap-3">
                <div className="flex-1">
                  <label className="label">Role</label>
                  <select className="field max-w-xs" value={detail.data.role.id}
                          onChange={(e) => updateRole.mutate(e.target.value)}>
                    {roles.map((r: any) => <option key={r.id} value={r.id}>{r.code.replaceAll('_',' ')}</option>)}
                  </select>
                </div>
                <p className="text-xs text-ink-200">
                  Changing role replaces the inherited permission set. Per-permission overrides still apply on top.
                </p>
              </div>

              <h4 className="mb-2 text-[11px] font-bold uppercase tracking-wider text-ink-200">Module access</h4>
              <p className="mb-3 text-xs text-ink-200">
                <span className="inline-flex items-center gap-1 rounded bg-ink-700/60 px-2 py-0.5">
                  <Minus size={11}/> Inherit from role
                </span>{' '}
                <span className="inline-flex items-center gap-1 rounded bg-emerald-500/15 px-2 py-0.5 text-emerald-300">
                  <Check size={11}/> Grant
                </span>{' '}
                <span className="inline-flex items-center gap-1 rounded bg-rose-500/15 px-2 py-0.5 text-rose-300">
                  <X size={11}/> Deny
                </span>
                {' '}— click a permission to cycle.
              </p>

              <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
                {MODULE_GROUPS.map((g) => (
                  <div key={g.label} className="rounded-lg border border-ink-500/40 bg-ink-700/30 p-3">
                    <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-brand-300">{g.label}</div>
                    <div className="flex flex-wrap gap-1.5">
                      {g.perms.map((code) => {
                        const eff = effectOf(code);
                        const active = isEffective(code);
                        return (
                          <button
                            key={code}
                            onClick={() => {
                              const next: 'INHERIT' | 'GRANT' | 'DENY' =
                                eff === 'INHERIT' ? (active ? 'DENY' : 'GRANT')
                                : eff === 'GRANT' ? 'DENY' : 'INHERIT';
                              setOverride.mutate({ permissionCode: code, effect: next });
                            }}
                            className={clsx(
                              'inline-flex items-center gap-1.5 rounded-md px-2.5 py-1 text-[11px] font-medium transition-colors',
                              eff === 'GRANT' && 'bg-emerald-500/15 text-emerald-300 ring-1 ring-emerald-500/40',
                              eff === 'DENY'  && 'bg-rose-500/15 text-rose-300 ring-1 ring-rose-500/40',
                              eff === 'INHERIT' && active && 'bg-ink-700/60 text-ink-100 ring-1 ring-ink-500/60',
                              eff === 'INHERIT' && !active && 'bg-transparent text-ink-200 ring-1 ring-ink-500/40',
                            )}
                            title={`${code} — currently ${active ? 'allowed' : 'blocked'} (${eff.toLowerCase()})`}
                          >
                            {eff === 'GRANT' && <Check size={11}/>}
                            {eff === 'DENY'  && <X size={11}/>}
                            {eff === 'INHERIT' && <Minus size={11}/>}
                            {code}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>

              <p className="mt-4 text-[11px] text-ink-200">
                Changes apply immediately. The user must sign out and back in for their menu and access to refresh.
              </p>
            </>
          )}
        </div>
      )}
    </div>
  );
}
