import { useEffect, useState } from 'react';
import { api } from '../api/client';
import { useAuth } from '../store/auth';

/**
 * Web Push lifecycle hook.
 *
 *  - Asks the browser for notification permission the first time a tech loads
 *    the app (after login).
 *  - Subscribes to push with the server's VAPID public key.
 *  - Sends the subscription up to /notify/subscribe so backend can push to it.
 *  - Listens for messages from the SW and plays a short alert sound if the
 *    page is visible (OS already handles sound when page is backgrounded).
 *
 * No-ops silently in unsupported browsers / HTTP contexts.
 */
export function usePushNotifications() {
  const role = useAuth((s) => s.user?.role ?? '');
  const token = useAuth((s) => s.token);
  const [status, setStatus] = useState<'idle' | 'requesting' | 'granted' | 'denied' | 'unsupported'>('idle');

  useEffect(() => {
    // Only techs need push - store users already know what they logged.
    if (!token) return;
    const roleUpper = role.toUpperCase();
    if (!['TECHNICIAN', 'IT_MANAGER', 'ADMINISTRATOR'].includes(roleUpper)) return;

    if (!('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) {
      setStatus('unsupported'); return;
    }
    if (window.location.protocol !== 'https:' && window.location.hostname !== 'localhost') {
      setStatus('unsupported'); return;
    }

    (async () => {
      try {
        if (Notification.permission === 'denied') { setStatus('denied'); return; }
        if (Notification.permission === 'default') {
          setStatus('requesting');
          const perm = await Notification.requestPermission();
          if (perm !== 'granted') { setStatus('denied'); return; }
        }
        setStatus('granted');

        const reg = await navigator.serviceWorker.ready;
        const { data: { publicKey } } = await api.get('/notify/vapid-public-key');
        if (!publicKey) { console.warn('Push: VAPID public key not configured on server'); return; }

        let sub = await reg.pushManager.getSubscription();
        if (!sub) {
          sub = await reg.pushManager.subscribe({
            userVisibleOnly: true,
            applicationServerKey: urlBase64ToUint8Array(publicKey),
          });
        }
        const { endpoint, keys } = sub.toJSON() as {
          endpoint: string; keys: { p256dh: string; auth: string };
        };
        await api.post('/notify/subscribe', {
          endpoint, keys, userAgent: navigator.userAgent.slice(0, 500),
        });
      } catch (e) {
        console.warn('Push setup failed:', e);
      }
    })();
  }, [token, role]);

  // Foreground ping: if the SW tells us to navigate (fallback for Safari where
  // Client.navigate isn't supported), play a short sound AND route.
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;
    const onMessage = (ev: MessageEvent) => {
      if (ev.data?.type === 'NAVIGATE' && ev.data.url) {
        playPing();
        window.location.assign(ev.data.url);
      }
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    return () => navigator.serviceWorker.removeEventListener('message', onMessage);
  }, []);

  return status;
}

// Short beep for in-foreground alerts (SW handles OS-level sound when
// backgrounded). WebAudio avoids packaging an audio file.
function playPing() {
  try {
    const AC = (window.AudioContext || (window as any).webkitAudioContext);
    if (!AC) return;
    const ctx = new AC();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, ctx.currentTime);
    osc.frequency.exponentialRampToValueAtTime(440, ctx.currentTime + 0.25);
    gain.gain.setValueAtTime(0.25, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.3);
    osc.connect(gain).connect(ctx.destination);
    osc.start();
    osc.stop(ctx.currentTime + 0.3);
  } catch { /* ignore */ }
}

function urlBase64ToUint8Array(b64: string): Uint8Array {
  const padding = '='.repeat((4 - b64.length % 4) % 4);
  const base64 = (b64 + padding).replace(/-/g, '+').replace(/_/g, '/');
  const raw = atob(base64);
  const out = new Uint8Array(raw.length);
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i);
  return out;
}
