import { create } from 'zustand';
import type { Room, Booking, BookingWithRoom, QuotaInfo } from '../types';
import { api } from '../api/client';

interface BookingState {
  rooms: Room[];
  myBookings: BookingWithRoom[];
  quota: QuotaInfo | null;
  loading: boolean;
  error: string | null;
  fetchRooms: () => Promise<void>;
  fetchAvailableRooms: (start: string, end: string, type?: string) => Promise<Room[]>;
  fetchRoomSchedule: (roomId: number, date: string) => Promise<{ room: Room; bookings: Booking[] }>;
  createBooking: (roomId: number, startTime: string, endTime: string) => Promise<void>;
  hotBook: (roomId: number) => Promise<void>;
  cancelBooking: (bookingId: number) => Promise<void>;
  fetchMyBookings: () => Promise<void>;
  fetchQuota: () => Promise<void>;
}

export const useBookingStore = create<BookingState>((set) => ({
  rooms: [],
  myBookings: [],
  quota: null,
  loading: false,
  error: null,

  fetchRooms: async () => {
    try {
      set({ loading: true });
      const { rooms } = await api.get<{ rooms: Room[] }>('/rooms');
      set({ rooms, loading: false });
    } catch (err: any) {
      set({ error: err.message, loading: false });
    }
  },

  fetchAvailableRooms: async (start, end, type?) => {
    const params = new URLSearchParams({ start, end });
    if (type) params.set('type', type);
    const { rooms } = await api.get<{ rooms: Room[] }>(`/rooms/available?${params}`);
    return rooms;
  },

  fetchRoomSchedule: async (roomId, date) => {
    return api.get(`/rooms/${roomId}/schedule?date=${date}`);
  },

  createBooking: async (roomId, startTime, endTime) => {
    await api.post('/rooms/book', { roomId, startTime, endTime });
    // Refresh bookings and quota
    const { bookings } = await api.get<{ bookings: BookingWithRoom[] }>('/rooms/my-bookings');
    const quota = await api.get<QuotaInfo>('/rooms/quota');
    set({ myBookings: bookings, quota });
  },

  hotBook: async (roomId) => {
    await api.post('/rooms/hot-book', { roomId });
    const { bookings } = await api.get<{ bookings: BookingWithRoom[] }>('/rooms/my-bookings');
    const quota = await api.get<QuotaInfo>('/rooms/quota');
    set({ myBookings: bookings, quota });
  },

  cancelBooking: async (bookingId) => {
    await api.delete(`/rooms/bookings/${bookingId}`);
    const { bookings } = await api.get<{ bookings: BookingWithRoom[] }>('/rooms/my-bookings');
    const quota = await api.get<QuotaInfo>('/rooms/quota');
    set({ myBookings: bookings, quota });
  },

  fetchMyBookings: async () => {
    try {
      const { bookings } = await api.get<{ bookings: BookingWithRoom[] }>('/rooms/my-bookings');
      set({ myBookings: bookings });
    } catch (err: any) {
      set({ error: err.message });
    }
  },

  fetchQuota: async () => {
    try {
      const quota = await api.get<QuotaInfo>('/rooms/quota');
      set({ quota });
    } catch (err: any) {
      set({ error: err.message });
    }
  },
}));
