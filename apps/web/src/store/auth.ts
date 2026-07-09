import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export interface SessionUser {
  id: string;
  email: string;
  fullName: string;
  role: string;
  storeId?: string | null;
  permissions: string[];
}

interface AuthState {
  token: string | null;
  user: SessionUser | null;
  setSession: (token: string, user: SessionUser) => void;
  logout: () => void;
  hasPermission: (perm: string) => boolean;
}

export const useAuth = create<AuthState>()(
  persist(
    (set, get) => ({
      token: null,
      user: null,
      setSession: (token, user) => set({ token, user }),
      logout: () => set({ token: null, user: null }),
      hasPermission: (p) => !!get().user?.permissions?.includes(p),
    }),
    { name: 'itamls-auth' },
  ),
);
