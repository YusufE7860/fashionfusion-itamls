import { useEffect, useState } from 'react';
import { Download, X, Monitor, Smartphone } from 'lucide-react';
import { useInstall } from '@/hooks/useInstall';

/**
 * One-shot PWA install prompt banner.
 *
 * Shows a small docked card at the bottom of the screen when the browser
 * fires `beforeinstallprompt`. The event fires on BOTH desktop and mobile
 * Chrome/Edge/Brave — same manifest + service worker install both. We just
 * tailor the copy and icon so each surface tells the user what they're
 * actually about to get.
 *
 * iOS Safari and Firefox don't fire this event — iOS users have to use the
 * share menu's "Add to Home Screen" manually, Firefox has no PWA install at
 * all. We don't nag those users here; the manifest + apple-touch-icon still
 * make the manual install do the right thing.
 */
export function InstallPrompt() {
  const { canInstall, promptInstall } = useInstall();
  const [visible, setVisible] = useState(false);

  const isMobile = typeof window !== 'undefined'
    && (/Android|iPhone|iPad|iPod|Mobile/i.test(navigator.userAgent)
        || window.matchMedia('(max-width: 768px)').matches);

  useEffect(() => {
    if (!canInstall) return;
    if (localStorage.getItem('itamls-install-dismissed')) return;
    setVisible(true);
  }, [canInstall]);

  if (!visible || !canInstall) return null;
  return (
    <div className="fixed bottom-20 left-4 right-4 z-40 md:bottom-4 md:left-auto md:right-4 md:max-w-sm">
      <div className="flex items-start gap-3 rounded-lg border border-ink-500/20 bg-white p-3 shadow-lg">
        {isMobile
          ? <Smartphone size={20} className="shrink-0 text-brand-600"/>
          : <Monitor    size={20} className="shrink-0 text-brand-600"/>}
        <div className="flex-1">
          <div className="text-sm font-semibold text-ink-100">
            Install ITAMLS {isMobile ? 'on your phone' : 'as a desktop app'}
          </div>
          <div className="mt-0.5 text-xs text-ink-300">
            {isMobile
              ? 'Adds to your home screen and runs full-screen like a native app.'
              : 'Opens in its own window from the Start menu / Dock. Right-click the icon for quick actions like "Log a ticket".'}
          </div>
          <div className="mt-2 flex gap-2">
            <button className="btn-primary"
              onClick={async () => {
                const outcome = await promptInstall();
                if (outcome !== 'accepted') {
                  localStorage.setItem('itamls-install-dismissed', '1');
                }
                setVisible(false);
              }}>
              <Download size={13}/>Install
            </button>
            <button className="btn-ghost text-xs"
              onClick={() => {
                localStorage.setItem('itamls-install-dismissed', '1');
                setVisible(false);
              }}>
              Not now
            </button>
          </div>
        </div>
        <button className="btn-ghost" onClick={() => setVisible(false)}><X size={12}/></button>
      </div>
    </div>
  );
}
