import { create } from 'zustand';
import { persist } from 'zustand/middleware';

/**
 * Portal theme (light / dark).
 *
 * Persisted in localStorage so the user's choice follows their device. The
 * actual class toggle lives in a small effect inside PortalLayout - we
 * flip `dark` on <html> so Tailwind's `dark:` variants pick up everywhere.
 */
type Mode = 'light' | 'dark';

interface ThemeState {
  mode: Mode;
  toggle: () => void;
  set: (m: Mode) => void;
}

export const useTheme = create<ThemeState>()(
  persist(
    (set, get) => ({
      mode: 'light',
      toggle: () => set({ mode: get().mode === 'light' ? 'dark' : 'light' }),
      set: (m) => set({ mode: m }),
    }),
    { name: 'itamls-portal-theme' },
  ),
);
