import { FormEvent, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/api/client';
import { useAuth } from '@/store/auth';
import { PageHeader } from '@/components/PageHeader';
import { formatZAR } from '@itamls/shared';
import { Upload } from 'lucide-react';

export function Invoices() {
  const qc = useQueryClient();
  const token = useAuth((s) => s.token);
  const [q, setQ] = useState('');
  const [showUpload, setShowUpload] = useState(false);

  const invoices = useQuery({
    queryKey: ['invoices', q],
    queryFn: () => api.get('/invoices', { params: q ? { q } : {} }).then((r) => r.data),
  });
  const suppliers = useQuery({
    queryKey: ['suppliers'],
    queryFn: () => api.get('/suppliers').then((r) => r.data),
  });

  const [form, setForm] = useState({
    docNo: '', supplierId: '', invoiceDate: new Date().toISOString().slice(0, 10),
    totalCents: 0, file: null as File | null,
  });

  const upload = useMutation({
    mutationFn: async () => {
      const fd = new FormData();
      fd.append('docNo', form.docNo);
      fd.append('supplierId', form.supplierId);
      fd.append('invoiceDate', form.invoiceDate);
      fd.append('totalCents', String(form.totalCents));
      if (form.file) fd.append('file', form.file);
      return api.post('/invoices', fd, { headers: { 'Content-Type': 'multipart/form-data' } }).then((r) => r.data);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['invoices'] });
      setShowUpload(false);
      setForm({ docNo: '', supplierId: '', invoiceDate: new Date().toISOString().slice(0, 10), totalCents: 0, file: null });
    },
  });

  function submit(e: FormEvent) {
    e.preventDefault();
    if (!form.docNo || !form.supplierId || !form.file) return;
    upload.mutate();
  }

  function openInvoice(id: string) {
    fetch(`${api.defaults.baseURL}/invoices/${id}/download`, { headers: { Authorization: `Bearer ${token}` } })
      .then((r) => r.blob())
      .then((b) => window.open(URL.createObjectURL(b), '_blank'));
  }

  return (
    <>
      <PageHeader
        title="Invoice Repository"
        subtitle="Supplier invoices, quotations and delivery notes — searchable, linked to assets and GRVs"
        actions={<button className="btn-primary" onClick={() => setShowUpload(!showUpload)}><Upload size={14}/>{showUpload ? 'Cancel' : 'Upload'}</button>}
      />

      {showUpload && (
        <form onSubmit={submit} className="card mb-4 p-4">
          <h3 className="mb-3 text-sm font-semibold">Upload an invoice</h3>
          <div className="grid grid-cols-2 gap-3 text-sm">
            <div><label className="label">Document number</label>
              <input className="field" value={form.docNo} onChange={(e) => setForm({ ...form, docNo: e.target.value })} required /></div>
            <div><label className="label">Supplier</label>
              <select className="field" value={form.supplierId} onChange={(e) => setForm({ ...form, supplierId: e.target.value })} required>
                <option value="">Pick…</option>
                {suppliers.data?.map((s: any) => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
            <div><label className="label">Invoice date</label>
              <input type="date" className="field" value={form.invoiceDate} onChange={(e) => setForm({ ...form, invoiceDate: e.target.value })} /></div>
            <div><label className="label">Total (cents)</label>
              <input type="number" className="field" value={form.totalCents} onChange={(e) => setForm({ ...form, totalCents: +e.target.value })} /></div>
            <div className="col-span-2"><label className="label">File (PDF, image, etc.)</label>
              <input type="file" className="field" accept="application/pdf,image/*" onChange={(e) => setForm({ ...form, file: e.target.files?.[0] ?? null })} required /></div>
          </div>
          <button className="btn-primary mt-3" disabled={upload.isPending}>
            {upload.isPending ? 'Uploading…' : 'Upload to repository'}
          </button>
          {upload.isError && <div className="mt-2 text-sm text-rose-600">Upload failed — is MinIO running on port 9000?</div>}
        </form>
      )}

      <div className="mb-3">
        <input className="field max-w-sm" placeholder="Search by doc no, supplier, OCR text…"
               value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      <div className="card overflow-hidden">
        <table className="w-full">
          <thead className="bg-slate-50">
            <tr>
              <th className="th">Doc No</th><th className="th">Supplier</th><th className="th">Date</th>
              <th className="th text-right">Total</th><th className="th">File</th>
            </tr>
          </thead>
          <tbody>
            {invoices.data?.map((i: any) => (
              <tr key={i.id} className="border-t">
                <td className="td font-mono">{i.docNo}</td>
                <td className="td">{i.supplier?.name}</td>
                <td className="td">{new Date(i.invoiceDate).toLocaleDateString()}</td>
                <td className="td text-right">{formatZAR(i.totalCents)}</td>
                <td className="td">
                  {i.fileUrl
                    ? <button className="text-brand-700 underline" onClick={() => openInvoice(i.id)}>Open</button>
                    : '—'}
                </td>
              </tr>
            ))}
            {(!invoices.data || invoices.data.length === 0) && (
              <tr><td className="td" colSpan={5}>No invoices uploaded yet.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </>
  );
}
