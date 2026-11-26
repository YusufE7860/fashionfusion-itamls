import { useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../store/auth';

/**
 * Idle-timeout session guard.
 *
 * Signs the user out after 30 minutes of no interaction. "Interaction" means
 * any mouse / keyboard / touch / scroll event anywhere in the window.
 *
 * Also persists the "last active" timestamp to localStorage so:
 *  - Reopening the tab after the window has expired is treated as idle
 *    and signs them out immediately on mount.
 *  - Multiple tabs share the clock (activity in one tab resets it in all).
 *
 * No-op if there's no token (user isn't signed in anyway).
 */
const IDLE_MINUTES = 30;
const WARN_MINUTES = 2;              // show a "signing you out in 2 min" warning window
const LAST_ACTIVE_KEY = 'itamls-last-active';

const ACTIVITY_EVENTS: (keyof WindowEventMap)[] = [
  'mousedown', 'mousemove', 'keydown', 'touchstart', 'scroll', 'wheel', 'click', 'focus',
];

export function useIdleTimeout() {
  const token    = useAuth((s) => s.token);
  const logout   = useAuth((s) => s.logout);
  const navigate = useNavigate();
  const timerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!token) return;

    const idleMs = IDLE_MINUTES * 60 * 1000;

    function markActive() {
      try { localStorage.setItem(LAST_ACTIVE_KEY, String(Date.now())); } catch {}
      // Reset the single scheduled timer. It's fine to recreate it on every
      // event because setTimeout is cheap; event handlers are throttled by
      // the browser's rAF boundary anyway.
      if (timerRef.current) window.clearTimeout(timerRef.current);
      timerRef.current = window.setTimeout(signOutIdle, idleMs);
    }

    function signOutIdle() {
      try { localStorage.removeItem(LAST_ACTIVE_KEY); } catch {}
      logout();
      // Keep the current URL as a return hint - after login the user lands
      // back where they were. Not critical for the portal but polite.
      const here = window.location.pathname + window.location.search;
      navigate(`/login${here !== '/login' ? `?next=${encodeURIComponent(here)}` : ''}`, { replace: true });
      // Hard notice so users understand why they're back at login.
      setTimeout(() => {
        try { alert('Signed out after 30 minutes of inactivity.'); } catch {}
      }, 50);
    }

    // On mount: if the stored lastActive is older than the window, assume
    // the browser was closed or the tab was ignored for too long -> sign out
    // immediately (before any API call runs with a stale token).
    try {
      const last = Number(localStorage.getItem(LAST_ACTIVE_KEY) || 0);
      if (last && Date.now() - last > idleMs) {
        signOutIdle();
        return;
      }
    } catch { /* ignore */ }

    // Prime the timer + start listening to activity.
    markActive();
    for (const e of ACTIVITY_EVENTS) window.addEventListener(e, markActive, { passive: true });

    // Cross-tab sync - if another tab updates the key, reset our timer too.
    function onStorage(ev: StorageEvent) {
      if (ev.key === LAST_ACTIVE_KEY && ev.newValue) {
        if (timerRef.current) window.clearTimeout(timerRef.current);
        const last = Number(ev.newValue);
        const remain = idleMs - (Date.now() - last);
        timerRef.current = window.setTimeout(signOutIdle, Math.max(remain, 1000));
      }
      // If another tab explicitly logged out (token cleared) - follow suit.
      if (ev.key === 'itamls-auth' && ev.newValue) {
        try {
          const parsed = JSON.parse(ev.newValue);
          if (!parsed?.state?.token) {
            logout();
            navigate('/login', { replace: true });
          }
        } catch {}
      }
    }
    window.addEventListener('storage', onStorage);

    return () => {
      for (const e of ACTIVITY_EVENTS) window.removeEventListener(e, markActive);
      window.removeEventListener('storage', onStorage);
      if (timerRef.current) window.clearTimeout(timerRef.current);
    };
  }, [token, logout, navigate]);
}
