import { create } from 'zustand';
import type { Notification } from '../types';
import { api } from '../api/client';

interface NotificationState {
  notifications: Notification[];
  unreadCount: number;
  loading: boolean;
  panelOpen: boolean;
  fetchNotifications: () => Promise<void>;
  markRead: (id: number) => Promise<void>;
  markAllRead: () => Promise<void>;
  togglePanel: () => void;
  closePanel: () => void;
}

export const useNotificationStore = create<NotificationState>((set) => ({
  notifications: [],
  unreadCount: 0,
  loading: false,
  panelOpen: false,

  fetchNotifications: async () => {
    try {
      set({ loading: true });
      const { notifications, unreadCount } = await api.get<{
        notifications: Notification[];
        unreadCount: number;
      }>('/notifications');
      set({ notifications, unreadCount, loading: false });
    } catch {
      set({ loading: false });
    }
  },

  markRead: async (id) => {
    await api.patch(`/notifications/${id}/read`);
    set((state) => ({
      notifications: state.notifications.map((n) =>
        n.id === id ? { ...n, isRead: true } : n
      ),
      unreadCount: Math.max(0, state.unreadCount - 1),
    }));
  },

  markAllRead: async () => {
    await api.patch('/notifications/read-all');
    set((state) => ({
      notifications: state.notifications.map((n) => ({ ...n, isRead: true })),
      unreadCount: 0,
    }));
  },

  togglePanel: () => set((state) => ({ panelOpen: !state.panelOpen })),
  closePanel: () => set({ panelOpen: false }),
}));
