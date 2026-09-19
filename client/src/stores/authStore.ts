import { create } from 'zustand';
import type { User } from '../types';
import { api } from '../api/client';

interface AuthState {
  user: User | null;
  loading: boolean;
  error: string | null;
  fetchUser: () => Promise<void>;
  updateUser: (data: Partial<User>) => Promise<void>;
}

export const useAuthStore = create<AuthState>((set) => ({
  user: null,
  loading: true,
  error: null,

  fetchUser: async () => {
    try {
      set({ loading: true, error: null });
      const { user } = await api.get<{ user: User }>('/users/me');
      set({ user, loading: false });
    } catch (err: any) {
      set({ error: err.message, loading: false });
    }
  },

  updateUser: async (data) => {
    try {
      const { user } = await api.patch<{ user: User }>('/users/me', data);
      set({ user });
    } catch (err: any) {
      throw err;
    }
  },
}));
