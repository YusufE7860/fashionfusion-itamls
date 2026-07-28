import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';
import { PageHeader } from '@/components/PageHeader';
import { ExternalLink, AlertTriangle } from 'lucide-react';

export function RemoteConsole() {
  const [params] = useSearchParams();
  const hostname = params.get('hostname') ?? '';

  const base = useQuery({
    queryKey: ['remote-base'],
    queryFn: () => api.get('/remote/base-url').then((r) => r.data),
  });

  const [iframeError, setIframeError] = useState(false);

  const meshUrl = base.data?.url
    ? `${base.data.url}/${hostname ? `?viewmode=1&search=${encodeURIComponent(hostname)}` : ''}`
    : '';

  useEffect(() => { setIframeError(false); }, [meshUrl]);

  return (
    <>
      <PageHeader
        title="Remote Console"
        subtitle={hostname ? `Filtered to ${hostname}` : 'MeshCentral browser-based remote desktop, terminal and file explorer'}
        actions={meshUrl && (
          <a href={meshUrl} target="_blank" rel="noreferrer" className="btn-ghost">
            <ExternalLink size={14}/>Open in new tab
          </a>
        )}
      />

      {!base.data && <div className="text-sm text-ink-300">Loading…</div>}

      {base.data && (
        <div className="card overflow-hidden" style={{ height: 'calc(100vh - 220px)' }}>
          {iframeError ? (
            <div className="grid h-full place-items-center p-8 text-center">
              <div>
                <AlertTriangle size={32} className="mx-auto mb-3 text-amber-500" />
                <div className="text-sm text-ink-100">
                  The MeshCentral console refused to load in an iframe.
                </div>
                <p className="mt-2 max-w-md text-xs text-ink-300">
                  If you're accessing via a self-signed HTTPS certificate, visit the mesh console once
                  directly (Open in new tab) to accept the certificate warning, then come back.
                </p>
                <a href={meshUrl} target="_blank" rel="noreferrer" className="btn-primary mt-4 inline-flex">
                  <ExternalLink size={14}/>Open MeshCentral
                </a>
              </div>
            </div>
          ) : (
            <iframe
              src={meshUrl}
              title="MeshCentral"
              className="h-full w-full border-0"
              allow="camera; microphone; clipboard-read; clipboard-write; fullscreen"
              onError={() => setIframeError(true)}
            />
          )}
        </div>
      )}
    </>
  );
}
