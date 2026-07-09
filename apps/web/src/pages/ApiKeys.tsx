import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { PageHeader } from '@/components/PageHeader';
import { Copy, KeyRound, ShieldOff } from 'lucide-react';

export function ApiKeys() {
  const qc = useQueryClient();
  const keys = useQuery({ queryKey: ['api-keys'], queryFn: () => api.get('/api-keys').then((r) => r.data) });

  const [label, setLabel] = useState('Kaseya VSA discovery');
  const [newKey, setNewKey] = useState<string | null>(null);

  const create = useMutation({
    mutationFn: () => api.post('/api-keys', { label, scope: 'DISCOVERY' }).then((r) => r.data),
    onSuccess: (d) => { setNewKey(d.key); qc.invalidateQueries({ queryKey: ['api-keys'] }); },
  });
  const revoke = useMutation({
    mutationFn: (id: string) => api.delete(`/api-keys/${id}`).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['api-keys'] }),
  });

  return (
    <>
      <PageHeader title="API Keys" subtitle="Used by the Kaseya VSA discovery script and other integrations" />

      <div className="card mb-4 p-4">
        <h3 className="mb-2 flex items-center gap-2 text-sm font-semibold"><KeyRound size={16}/>Create a new key</h3>
        <div className="flex gap-2">
          <input className="field flex-1" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="Label" />
          <button className="btn-primary" onClick={() => create.mutate()} disabled={create.isPending}>
            {create.isPending ? 'Creating…' : 'Generate'}
          </button>
        </div>
        {newKey && (
          <div className="mt-3 rounded-md border border-amber-300 bg-amber-50 p-3">
            <div className="text-sm font-semibold text-amber-900">Copy this key — you won't see it again</div>
            <div className="mt-2 flex items-center gap-2">
              <code className="flex-1 break-all rounded bg-white px-3 py-2 font-mono text-sm">{newKey}</code>
              <button className="btn-ghost" onClick={() => navigator.clipboard.writeText(newKey)}>
                <Copy size={14}/>Copy
              </button>
            </div>
            <p className="mt-2 text-xs text-amber-800">
              Paste into your Kaseya VSA procedure as the <code>ApiKey</code> parameter. Treat like a password.
            </p>
          </div>
        )}
      </div>

      <div className="card overflow-hidden">
        <table className="w-full">
          <thead className="bg-slate-50">
            <tr>
              <th className="th">Label</th><th className="th">Prefix</th>
              <th className="th">Scope</th><th className="th">Created</th>
              <th className="th">Last used</th><th className="th">Status</th><th className="th"></th>
            </tr>
          </thead>
          <tbody>
            {keys.data?.map((k: any) => (
              <tr key={k.id} className="border-t">
                <td className="td">{k.label}</td>
                <td className="td font-mono text-xs">{k.prefix}…</td>
                <td className="td"><span className="pill-blue">{k.scope}</span></td>
                <td className="td">{new Date(k.createdAt).toLocaleDateString()}</td>
                <td className="td">{k.lastUsedAt ? new Date(k.lastUsedAt).toLocaleString() : '—'}</td>
                <td className="td">
                  {k.revokedAt
                    ? <span className="pill-red">Revoked</span>
                    : <span className="pill-green">Active</span>}
                </td>
                <td className="td">
                  {!k.revokedAt &&
                    <button className="btn-ghost" onClick={() => revoke.mutate(k.id)}>
                      <ShieldOff size={14}/>Revoke
                    </button>}
                </td>
              </tr>
            ))}
            {(!keys.data || keys.data.length === 0) && (
              <tr><td className="td" colSpan={7}>No keys yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
