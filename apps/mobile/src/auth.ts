import { create } from 'zustand';
import AsyncStorage from '@react-native-async-storage/async-storage';

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
  hydrate: () => Promise<void>;
  setSession: (token: string, user: SessionUser) => Promise<void>;
  logout: () => Promise<void>;
  hasPermission: (perm: string) => boolean;
}

export const useAuth = create<AuthState>((set, get) => ({
  token: null,
  user: null,
  hydrate: async () => {
    const [t, u] = await Promise.all([
      AsyncStorage.getItem('itamls_token'),
      AsyncStorage.getItem('itamls_user'),
    ]);
    set({ token: t, user: u ? JSON.parse(u) : null });
  },
  setSession: async (token, user) => {
    await AsyncStorage.setItem('itamls_token', token);
    await AsyncStorage.setItem('itamls_user', JSON.stringify(user));
    set({ token, user });
  },
  logout: async () => {
    await AsyncStorage.removeItem('itamls_token');
    await AsyncStorage.removeItem('itamls_user');
    set({ token: null, user: null });
  },
  hasPermission: (p) => !!get().user?.permissions?.includes(p),
}));
