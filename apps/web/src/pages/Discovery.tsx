import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { PageHeader } from '@/components/PageHeader';

export function Discovery() {
  const recent = useQuery({ queryKey: ['discovery'], queryFn: () => api.get('/discovery/recent').then((r) => r.data) });

  return (
    <>
      <PageHeader title="Discovered Devices" subtitle="Latest hardware reports from the Kaseya VSA discovery agent" />
      <div className="card overflow-hidden">
        <table className="w-full">
          <thead className="bg-slate-50">
            <tr>
              <th className="th">Reported</th><th className="th">Hostname</th>
              <th className="th">Manufacturer</th><th className="th">Model</th>
              <th className="th">Serial</th><th className="th">OS</th>
              <th className="th text-right">RAM</th><th className="th">From IP</th>
            </tr>
          </thead>
          <tbody>
            {recent.data?.map((r: any) => (
              <tr key={r.id} className="border-t">
                <td className="td">{new Date(r.reportedAt).toLocaleString()}</td>
                <td className="td font-mono text-xs">{r.hostname}</td>
                <td className="td">{r.manufacturer ?? '—'}</td>
                <td className="td">{r.model ?? '—'}</td>
                <td className="td font-mono text-xs">{r.serialNo ?? '—'}</td>
                <td className="td text-xs">{r.osVersion ?? '—'}</td>
                <td className="td text-right">{r.ramGb ? `${r.ramGb} GB` : '—'}</td>
                <td className="td font-mono text-xs">{r.sourceIp ?? '—'}</td>
              </tr>
            ))}
            {(!recent.data || recent.data.length === 0) && (
              <tr><td className="td" colSpan={8}>
                No reports yet. Run the discovery script on any Windows machine to start populating this list.
              </td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
