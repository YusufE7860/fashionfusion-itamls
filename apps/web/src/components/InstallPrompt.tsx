import { useEffect, useState } from 'react';
import { Download, X } from 'lucide-react';

/**
 * One-shot PWA install prompt banner.
 *
 * Shows a small docked card at the bottom of the screen when the browser
 * fires `beforeinstallprompt`. Users can install (home-screen icon,
 * standalone window) or dismiss. Dismissal is remembered in localStorage so
 * we don't nag them.
 */
export function InstallPrompt() {
  const [deferred, setDeferred] = useState<any>(null);
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const key = 'itamls-install-dismissed';
    if (localStorage.getItem(key)) return;
    const h = (e: any) => {
      e.preventDefault();
      setDeferred(e);
      setVisible(true);
    };
    window.addEventListener('beforeinstallprompt', h);
    return () => window.removeEventListener('beforeinstallprompt', h);
  }, []);

  if (!visible || !deferred) return null;
  return (
    <div className="fixed bottom-20 left-4 right-4 z-40 md:bottom-4 md:left-auto md:right-4 md:max-w-sm">
      <div className="flex items-start gap-3 rounded-lg border border-ink-500/20 bg-white p-3 shadow-lg">
        <Download size={20} className="shrink-0 text-brand-600"/>
        <div className="flex-1">
          <div className="text-sm font-semibold text-ink-100">Install ITAMLS</div>
          <div className="mt-0.5 text-xs text-ink-300">
            Add to your home screen for fullscreen access + quicker loads.
          </div>
          <div className="mt-2 flex gap-2">
            <button className="btn-primary"
              onClick={async () => {
                try { await deferred.prompt(); } catch { /* user cancelled */ }
                setVisible(false); setDeferred(null);
              }}>
              Install
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
