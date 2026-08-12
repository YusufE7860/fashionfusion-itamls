import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { PageHeader } from '@/components/PageHeader';
import { useAuth } from '@/store/auth';
import { Download, Copy, RefreshCw, Router as RouterIcon, Save, Settings2 } from 'lucide-react';

type Pool = {
  brand: string;
  displayName: string;
  identityPrefix: string;
  ipPrefix: string;
  cidr: number;
  lastThirdOctet: number;
};
type Preview = {
  brand: string;
  displayName: string;
  identityPrefix: string;
  thirdOctet: number;
  lanGateway: string;
  lanNetwork: string;
  cidr: number;
  dhcpRangeStart: string;
  dhcpRangeEnd: string;
};
type Config = {
  id: string; brand: string; siteCode: string; identity: string;
  lanGateway: string; lanNetwork: string; cidr: number; thirdOctet: number;
  createdAt: string; configText?: string;
};

const emptyForm = {
  brand: 'FASHION_FUSION',
  siteCode: '',
  wan1Type: 'DHCP' as 'DHCP' | 'PPPOE',
  wan1Iface: 'ether1-WAN1',
  wan1PppoeUser: '',
  wan1PppoePassword: '',
  wan2Type: 'DHCP' as 'DHCP' | 'PPPOE',
  wan2Iface: 'ether5-WAN2',
  wan2PppoeUser: '',
  wan2PppoePassword: '',
  ssid: '',
  wpaPsk: '',
  wgListenPort: 51820,
  wgHubPublicKey: 'N3x2X1+bvBeKsWb790Tef92R9BS/Zaa8t3OMCX8NGGc=',
  wgHubEndpoint: '160.119.193.152',
  wgHubEndpointPort: 443,
  wgTunnelIp: '',
  remoteWinboxBlock: '',
  dhcpRangeStart: '',
  dhcpRangeEnd: '',
};

export function Mikrotik() {
  const qc = useQueryClient();
  const hasPerm = useAuth((s) => s.hasPermission);
  const token = useAuth((s) => s.token);
  const canManage = hasPerm('mikrotik:manage');
  const canGen = hasPerm('mikrotik:generate');

  const pools = useQuery({ queryKey: ['mk-pools'], queryFn: () => api.get<Pool[]>('/mikrotik/pools').then((r) => r.data) });
  const configs = useQuery({ queryKey: ['mk-configs'], queryFn: () => api.get<Config[]>('/mikrotik/configs').then((r) => r.data) });

  const [form, setForm] = useState({ ...emptyForm });
  const [generated, setGenerated] = useState<Config | null>(null);

  const preview = useQuery({
    queryKey: ['mk-preview', form.brand],
    queryFn: () => api.get<Preview>('/mikrotik/preview', { params: { brand: form.brand } }).then((r) => r.data),
    enabled: !!form.brand,
  });

  // Prefill DHCP range from preview if user hasn't overridden.
  useEffect(() => {
    if (!preview.data) return;
    setForm((f) => ({
      ...f,
      dhcpRangeStart: f.dhcpRangeStart || preview.data!.dhcpRangeStart,
      dhcpRangeEnd:   f.dhcpRangeEnd   || preview.data!.dhcpRangeEnd,
    }));
  }, [preview.data]);

  const generate = useMutation({
    mutationFn: () => api.post<Config>('/mikrotik/generate', form).then((r) => r.data),
    onSuccess: (data) => {
      setGenerated(data);
      qc.invalidateQueries({ queryKey: ['mk-pools'] });
      qc.invalidateQueries({ queryKey: ['mk-preview', form.brand] });
      qc.invalidateQueries({ queryKey: ['mk-configs'] });
    },
  });

  const [poolEdits, setPoolEdits] = useState<Record<string, number>>({});
  const savePool = useMutation({
    mutationFn: ({ brand, lastThirdOctet }: { brand: string; lastThirdOctet: number }) =>
      api.patch(`/mikrotik/pools/${brand}`, { lastThirdOctet }).then((r) => r.data),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['mk-pools'] }),
  });

  const brandOptions = pools.data ?? [];
  const identity = useMemo(() => {
    const p = brandOptions.find((b) => b.brand === form.brand);
    if (!p || !form.siteCode) return '';
    return `${p.identityPrefix}-${form.siteCode.replace(/[^A-Za-z0-9_-]/g, '')}-GW`;
  }, [brandOptions, form.brand, form.siteCode]);

  function downloadConfig(id: string, identity: string) {
    fetch(`${api.defaults.baseURL}/mikrotik/configs/${id}/download`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then((r) => r.blob())
      .then((b) => {
        const url = URL.createObjectURL(b);
        const a = document.createElement('a');
        a.href = url; a.download = `${identity}.rsc`; a.click();
      });
  }

  function copyConfig() {
    if (!generated?.configText) return;
    navigator.clipboard.writeText(generated.configText);
  }

  return (
    <>
      <PageHeader
        title="MikroTik Config Generator"
        subtitle="Generate a new store router config; next /24 is allocated automatically per brand"
      />

      {/* Pool status */}
      <section className="card mb-4 p-4">
        <div className="mb-3 flex items-center gap-2">
          <RouterIcon size={16} className="text-brand-600" />
          <h2 className="text-sm font-semibold text-slate-700">Network pools</h2>
        </div>
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {brandOptions.map((p) => {
            const nextOctet = p.lastThirdOctet + 1;
            const nextGateway = `${p.ipPrefix}.${nextOctet}.1`;
            const editVal = poolEdits[p.brand] ?? p.lastThirdOctet;
            return (
              <div key={p.brand} className="rounded-lg border border-ink-500 bg-white p-3">
                <div className="flex items-center justify-between">
                  <div>
                    <div className="text-sm font-semibold text-ink-50">{p.displayName}</div>
                    <div className="text-[11px] uppercase tracking-wider text-ink-300">{p.identityPrefix} · {p.ipPrefix}.0.0/16</div>
                  </div>
                  <div className="text-right">
                    <div className="text-[11px] text-ink-300">Next store</div>
                    <div className="font-mono text-sm text-brand-700">{nextGateway}</div>
                  </div>
                </div>
                {canManage && (
                  <div className="mt-3 flex items-end gap-2">
                    <div className="flex-1">
                      <label className="label">Last handed out (third octet)</label>
                      <input type="number" className="field" min={0} max={254}
                        value={editVal}
                        onChange={(e) => setPoolEdits({ ...poolEdits, [p.brand]: +e.target.value })} />
                    </div>
                    <button className="btn-ghost" disabled={editVal === p.lastThirdOctet || savePool.isPending}
                      onClick={() => savePool.mutate({ brand: p.brand, lastThirdOctet: editVal })}>
                      <Save size={13}/>Save
                    </button>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </section>

      {/* Generator form */}
      <section className="card mb-4 p-4">
        <div className="mb-3 flex items-center gap-2">
          <Settings2 size={16} className="text-brand-600" />
          <h2 className="text-sm font-semibold text-slate-700">Generate new store config</h2>
        </div>

        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          <div>
            <label className="label">Brand</label>
            <select className="field" value={form.brand} onChange={(e) => setForm({ ...form, brand: e.target.value, dhcpRangeStart: '', dhcpRangeEnd: '' })}>
              {brandOptions.map((b) => <option key={b.brand} value={b.brand}>{b.displayName}</option>)}
            </select>
          </div>
          <div>
            <label className="label">Site code (no spaces)</label>
            <input className="field" placeholder="e.g. Empangeni" value={form.siteCode}
              onChange={(e) => setForm({ ...form, siteCode: e.target.value })} />
          </div>
          <div>
            <label className="label">Router identity (auto)</label>
            <input className="field" readOnly value={identity || '—'} />
          </div>

          <div>
            <label className="label">LAN gateway (auto)</label>
            <input className="field" readOnly value={preview.data?.lanGateway ?? '—'} />
          </div>
          <div>
            <label className="label">LAN network (auto)</label>
            <input className="field" readOnly value={preview.data ? `${preview.data.lanNetwork}/24` : '—'} />
          </div>
          <div>
            <label className="label">Next third octet (auto)</label>
            <div className="flex items-center gap-2">
              <input className="field" readOnly value={preview.data?.thirdOctet ?? '—'} />
              <button className="btn-ghost" onClick={() => preview.refetch()} title="Refresh">
                <RefreshCw size={13}/>
              </button>
            </div>
          </div>

          <div>
            <label className="label">DHCP range start</label>
            <input className="field" value={form.dhcpRangeStart}
              onChange={(e) => setForm({ ...form, dhcpRangeStart: e.target.value })} />
          </div>
          <div>
            <label className="label">DHCP range end</label>
            <input className="field" value={form.dhcpRangeEnd}
              onChange={(e) => setForm({ ...form, dhcpRangeEnd: e.target.value })} />
          </div>
          <div>
            <label className="label">WireGuard tunnel IP (from DC team)</label>
            <input className="field" placeholder="172.31.254.15/32" value={form.wgTunnelIp}
              onChange={(e) => setForm({ ...form, wgTunnelIp: e.target.value })} />
          </div>

          {/* Wireless */}
          <div>
            <label className="label">Wireless SSID</label>
            <input className="field" value={form.ssid} onChange={(e) => setForm({ ...form, ssid: e.target.value })} />
          </div>
          <div className="md:col-span-2">
            <label className="label">WPA2 PSK</label>
            <input className="field" value={form.wpaPsk} onChange={(e) => setForm({ ...form, wpaPsk: e.target.value })} />
          </div>

          {/* WAN1 */}
          <div>
            <label className="label">WAN 1 type</label>
            <select className="field" value={form.wan1Type} onChange={(e) => setForm({ ...form, wan1Type: e.target.value as any })}>
              <option value="DHCP">DHCP</option>
              <option value="PPPOE">PPPoE (fiber)</option>
            </select>
          </div>
          <div>
            <label className="label">WAN 1 interface</label>
            <input className="field" value={form.wan1Iface} onChange={(e) => setForm({ ...form, wan1Iface: e.target.value })} />
          </div>
          <div className="md:col-span-1" />
          {form.wan1Type === 'PPPOE' && (
            <>
              <div><label className="label">WAN 1 PPPoE user</label>
                <input className="field" value={form.wan1PppoeUser} onChange={(e) => setForm({ ...form, wan1PppoeUser: e.target.value })} /></div>
              <div className="md:col-span-2"><label className="label">WAN 1 PPPoE password</label>
                <input className="field" value={form.wan1PppoePassword} onChange={(e) => setForm({ ...form, wan1PppoePassword: e.target.value })} /></div>
            </>
          )}

          {/* WAN2 */}
          <div>
            <label className="label">WAN 2 type</label>
            <select className="field" value={form.wan2Type} onChange={(e) => setForm({ ...form, wan2Type: e.target.value as any })}>
              <option value="DHCP">DHCP</option>
              <option value="PPPOE">PPPoE (fiber)</option>
            </select>
          </div>
          <div>
            <label className="label">WAN 2 interface</label>
            <input className="field" value={form.wan2Iface} onChange={(e) => setForm({ ...form, wan2Iface: e.target.value })} />
          </div>
          <div className="md:col-span-1" />
          {form.wan2Type === 'PPPOE' && (
            <>
              <div><label className="label">WAN 2 PPPoE user</label>
                <input className="field" value={form.wan2PppoeUser} onChange={(e) => setForm({ ...form, wan2PppoeUser: e.target.value })} /></div>
              <div className="md:col-span-2"><label className="label">WAN 2 PPPoE password</label>
                <input className="field" value={form.wan2PppoePassword} onChange={(e) => setForm({ ...form, wan2PppoePassword: e.target.value })} /></div>
            </>
          )}

          {/* RemoteWinbox */}
          <div className="md:col-span-3">
            <label className="label">RemoteWinbox VPN block — paste the site-specific snippet</label>
            <textarea className="field font-mono text-xs" rows={8}
              placeholder={`/interface sstp-client\nadd name=RemoteWinboxVPN-ZA ... user=... password=... connect-to=zavpn.remotewinbox.com ...`}
              value={form.remoteWinboxBlock}
              onChange={(e) => setForm({ ...form, remoteWinboxBlock: e.target.value })} />
            <p className="mt-1 text-[11px] text-ink-300">
              This block is embedded verbatim. The SSTP VDC tunnel is NOT generated — your MSP adds it after applying.
            </p>
          </div>
        </div>

        <div className="mt-4 flex items-center gap-2">
          <button className="btn-primary" disabled={!canGen || generate.isPending}
            onClick={() => generate.mutate()}>
            {generate.isPending ? 'Generating…' : 'Generate config'}
          </button>
          {generate.isError && <span className="text-xs text-rose-600">{(generate.error as any)?.response?.data?.message ?? 'Failed'}</span>}
        </div>
      </section>

      {/* Generated output */}
      {generated && (
        <section className="card mb-4 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-sm font-semibold text-slate-700">Generated .rsc — {generated.identity}</h2>
            <div className="flex gap-2">
              <button className="btn-ghost" onClick={copyConfig}><Copy size={13}/>Copy</button>
              <button className="btn-primary" onClick={() => downloadConfig(generated.id, generated.identity)}>
                <Download size={13}/>Download
              </button>
            </div>
          </div>
          <textarea className="field font-mono text-[11px]" rows={22} readOnly value={generated.configText ?? ''} />
        </section>
      )}

      {/* History */}
      <section className="card p-4">
        <h2 className="mb-3 text-sm font-semibold text-slate-700">Previously generated configs</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="th text-left">Generated</th>
                <th className="th text-left">Identity</th>
                <th className="th text-left">Brand</th>
                <th className="th text-left">LAN</th>
                <th className="th text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {configs.data?.map((c) => (
                <tr key={c.id} className="border-b border-ink-500/20">
                  <td className="py-2 text-xs">{new Date(c.createdAt).toLocaleString()}</td>
                  <td className="py-2 font-mono text-xs">{c.identity}</td>
                  <td className="py-2 text-xs">{c.brand}</td>
                  <td className="py-2 font-mono text-xs">{c.lanGateway}/{c.cidr}</td>
                  <td className="py-2 text-right">
                    <button className="btn-ghost" onClick={() => downloadConfig(c.id, c.identity)}>
                      <Download size={12}/>.rsc
                    </button>
                  </td>
                </tr>
              ))}
              {configs.data?.length === 0 && (
                <tr><td colSpan={5} className="py-4 text-center text-xs text-ink-300">No configs generated yet.</td></tr>
              )}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
