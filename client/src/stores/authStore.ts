import { create } from 'zustand';
import type { User } from '../types';
import { api } from '../api/client';
import { read, write } from '../lib/cache';

interface AuthState {
  user: User | null;
  loading: boolean;
  error: unknown;
  fetchUser: () => Promise<void>;
  updateUser: (data: Partial<User>) => Promise<void>;
}

// The profile from the last visit: the first screen draws at once, the fresh one replaces it quietly
const cached = read<User>('user')?.data ?? null;

export const useAuthStore = create<AuthState>((set, get) => ({
  user: cached,
  loading: !cached,
  error: null,

  fetchUser: async () => {
    const shown = get().user;
    set({ loading: !shown, error: null });
    try {
      const { user } = await api.get<{ user: User }>('/users/me');
      write('user', user);
      set({ user, loading: false });
    } catch (err) {
      // Offline with a profile on screen: keep it, the screens show their own "дані на 20:58"
      set(shown ? { loading: false } : { error: err, loading: false });
    }
  },

  updateUser: async (data) => {
    const { user } = await api.patch<{ user: User }>('/users/me', data);
    write('user', user);
    set({ user });
  },
}));
