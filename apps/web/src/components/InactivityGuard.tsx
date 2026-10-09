import { useEffect, useRef, useState } from 'react';
import { useAuth } from '@/store/auth';
import { AlertTriangle } from 'lucide-react';

const IDLE_MS      = Number(import.meta.env.VITE_IDLE_MS      ?? 30 * 60_000); // 30 min default
const WARN_MS      = Number(import.meta.env.VITE_IDLE_WARN_MS ?? 60_000);      // warn 1 min before
const CHECK_EVERY  = 5_000;

// Events that count as "still here"
const ACTIVITY_EVENTS = ['mousemove', 'mousedown', 'keydown', 'wheel', 'touchstart', 'scroll'];

/**
 * Logs the user out after a period of inactivity. Shows a countdown dialog
 * one minute before so a drive-by click can abort the logout.
 *
 * Tune via Vite env vars at build:
 *   VITE_IDLE_MS=1800000      (30 min)
 *   VITE_IDLE_WARN_MS=60000   (1 min warning)
 */
export function InactivityGuard() {
  const token  = useAuth((s) => s.token);
  const logout = useAuth((s) => s.logout);
  const lastActivity = useRef<number>(Date.now());
  const [secondsLeft, setSecondsLeft] = useState<number | null>(null);

  // Record activity (shared across tabs via localStorage so one active tab
  // keeps the whole session alive).
  useEffect(() => {
    if (!token) return;

    const bump = () => {
      lastActivity.current = Date.now();
      try { localStorage.setItem('itamls-last-activity', String(lastActivity.current)); } catch { /* ignore */ }
      // Dismiss the warning the moment the user moves
      if (secondsLeft !== null) setSecondsLeft(null);
    };

    for (const evt of ACTIVITY_EVENTS) {
      window.addEventListener(evt, bump, { passive: true });
    }

    // Pick up activity from other tabs
    const onStorage = (e: StorageEvent) => {
      if (e.key === 'itamls-last-activity' && e.newValue) {
        const t = Number(e.newValue);
        if (t > lastActivity.current) lastActivity.current = t;
      }
    };
    window.addEventListener('storage', onStorage);

    // Seed from storage so a reload keeps the counter honest
    try {
      const stored = Number(localStorage.getItem('itamls-last-activity') ?? 0);
      if (stored && Date.now() - stored < IDLE_MS) lastActivity.current = stored;
    } catch { /* ignore */ }

    return () => {
      for (const evt of ACTIVITY_EVENTS) window.removeEventListener(evt, bump);
      window.removeEventListener('storage', onStorage);
    };
  // Intentionally re-create on token change; secondsLeft deliberately not a dep
  // to avoid re-subscribing every second when the warning is counting down.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  // Idle check loop
  useEffect(() => {
    if (!token) return;
    const t = setInterval(() => {
      const idle = Date.now() - lastActivity.current;
      if (idle >= IDLE_MS) {
        try { localStorage.removeItem('itamls-last-activity'); } catch {}
        logout();
        return;
      }
      const remaining = IDLE_MS - idle;
      if (remaining <= WARN_MS) {
        setSecondsLeft(Math.ceil(remaining / 1000));
      } else if (secondsLeft !== null) {
        setSecondsLeft(null);
      }
    }, CHECK_EVERY);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [token]);

  if (!token || secondsLeft === null) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60 p-4">
      <div className="w-full max-w-sm rounded-lg bg-white p-5 shadow-2xl">
        <div className="mb-3 flex items-center gap-2 text-amber-600">
          <AlertTriangle size={18}/>
          <h3 className="text-lg font-semibold">Still there?</h3>
        </div>
        <p className="text-sm text-ink-100">
          You'll be signed out in <b>{secondsLeft}</b> second{secondsLeft === 1 ? '' : 's'} because of inactivity.
        </p>
        <p className="mt-1 text-xs text-ink-300">
          Move the mouse, press a key, or click below to stay signed in.
        </p>
        <div className="mt-4 flex justify-end gap-2">
          <button className="btn-ghost" onClick={() => logout()}>Sign out now</button>
          <button className="btn-primary" onClick={() => {
            lastActivity.current = Date.now();
            try { localStorage.setItem('itamls-last-activity', String(lastActivity.current)); } catch {}
            setSecondsLeft(null);
          }}>
            I'm still here
          </button>
        </div>
      </div>
    </div>
  );
}
