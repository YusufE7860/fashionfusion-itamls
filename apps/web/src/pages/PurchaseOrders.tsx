import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { PageHeader } from '@/components/PageHeader';
import { Pill } from '@/components/Pill';
import { formatZAR } from '@itamls/shared';
import { useAuth } from '@/store/auth';
import { Download } from 'lucide-react';

/**
 * Purchase Orders list. The actual PO creation flow lives on the
 * Purchase Requests page (an approved PR → POS button). This page is
 * about status visibility + downloading the printed PDF that matches
 * Fashion Fusion's existing paper book.
 */
export function PurchaseOrders() {
  const token = useAuth((s) => s.token);
  const pos = useQuery({
    queryKey: ['pos'],
    queryFn: () => api.get<any[]>('/purchase-orders').then((r) => r.data),
  });

  async function downloadPdf(po: any) {
    const base = (api.defaults.baseURL ?? '').replace(/\/$/, '')
      || `${window.location.origin}/api/v1`;
    const res = await fetch(`${base}/purchase-orders/${po.id}/pdf`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!res.ok) { alert('Could not download PDF — ' + res.statusText); return; }
    const blob = await res.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `PO-${po.code}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <>
      <PageHeader
        title="Purchase Orders"
        subtitle="Approved purchase requests that have been issued to a supplier — download the PO as a PDF for signature and emailing"
      />

      <div className="card overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="th text-left">Code</th>
                <th className="th text-left">Supplier</th>
                <th className="th text-left">Linked PR</th>
                <th className="th text-left">Sent</th>
                <th className="th text-left">Expected</th>
                <th className="th text-left">Status</th>
                <th className="th text-right">Total</th>
                <th className="th text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pos.data?.map((po: any) => (
                <tr key={po.id} className="border-t">
                  <td className="td font-mono">{po.code}</td>
                  <td className="td">{po.supplier?.name ?? '—'}</td>
                  <td className="td font-mono">{po.pr?.code ?? '—'}</td>
                  <td className="td">{po.sentAt ? new Date(po.sentAt).toLocaleDateString() : '—'}</td>
                  <td className="td">{po.expectedDelivery ? new Date(po.expectedDelivery).toLocaleDateString() : '—'}</td>
                  <td className="td"><Pill status={po.status}/></td>
                  <td className="td text-right">{formatZAR(po.totalCents)}</td>
                  <td className="td text-right">
                    <button className="btn-ghost" title="Download the PO as a PDF matching the paper book"
                      onClick={() => downloadPdf(po)}>
                      <Download size={12}/>PDF
                    </button>
                  </td>
                </tr>
              ))}
              {(!pos.data || pos.data.length === 0) && (
                <tr>
                  <td className="td py-8 text-center text-xs text-ink-300" colSpan={8}>
                    No purchase orders yet. Approve a Purchase Request to generate one.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}
