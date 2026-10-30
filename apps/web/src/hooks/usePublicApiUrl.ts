import { useQuery } from '@tanstack/react-query';
import { api } from '@/api/client';

/**
 * Returns the server-configured public API URL — the DNS-based URL that
 * works from anywhere on the internet (e.g. https://it.ffgsa.co.za:41235/api/v1),
 * NOT the LAN IP the admin may have used to reach this page.
 *
 * Every installer command / curl one-liner / download link in the admin UI
 * must use this instead of `api.defaults.baseURL`, otherwise an admin who
 * loaded the app via http://10.168.0.55:41235/ will embed that LAN IP in
 * the installer — and a store 500km away can't reach it.
 *
 * Falls back to window.location.origin + /api/v1 if the server didn't set
 * PUBLIC_API_URL (dev + bootstrap edge case).
 */
export function usePublicApiUrl() {
  const q = useQuery({
    queryKey: ['system-public-config'],
    queryFn: () => api.get('/system/public-config').then((r) => r.data),
    // Essentially static — cache for the whole session.
    staleTime: 60 * 60 * 1000,
    gcTime:    60 * 60 * 1000,
    retry: 1,
  });
  const fromServer: string = q.data?.publicApiUrl ?? '';
  const configured = fromServer.replace(/\/$/, '');
  const fallback = `${window.location.origin}/api/v1`;
  return {
    apiUrl: configured || fallback,
    webUrl: (q.data?.publicWebUrl ?? '').replace(/\/$/, '') || window.location.origin,
    loading: q.isLoading,
    isConfigured: !!configured,
  };
}
