import { useEffect, useState } from 'react';

/**
 * Shared install hook. Captures the `beforeinstallprompt` event once per page
 * load and lets any component trigger it on demand.
 *
 * The browser only fires `beforeinstallprompt` ONCE per load, and only when
 * the app meets install criteria (served over HTTPS, valid manifest, SW
 * registered, user has engaged with the page). After an install, the event
 * won't fire again — we also surface `isStandalone` so UI can hide install
 * CTAs for people already running the installed app.
 */
export function useInstall() {
  const [deferred, setDeferred] = useState<any>(null);
  const [isStandalone, setIsStandalone] = useState(false);
  const [installed, setInstalled] = useState(false);

  useEffect(() => {
    setIsStandalone(
      window.matchMedia('(display-mode: standalone)').matches
      || (window.navigator as any).standalone === true,
    );
    const onBefore = (e: any) => {
      e.preventDefault();
      setDeferred(e);
    };
    const onInstalled = () => { setInstalled(true); setDeferred(null); };
    window.addEventListener('beforeinstallprompt', onBefore);
    window.addEventListener('appinstalled', onInstalled);
    return () => {
      window.removeEventListener('beforeinstallprompt', onBefore);
      window.removeEventListener('appinstalled', onInstalled);
    };
  }, []);

  async function promptInstall(): Promise<'accepted' | 'dismissed' | 'unavailable'> {
    if (!deferred) return 'unavailable';
    try {
      await deferred.prompt();
      const choice = await deferred.userChoice;
      setDeferred(null);
      return (choice?.outcome ?? 'dismissed') as any;
    } catch {
      return 'dismissed';
    }
  }

  return {
    canInstall: !!deferred && !isStandalone && !installed,
    isStandalone,
    installed,
    promptInstall,
  };
}
