import { create } from 'zustand';
import type { MoodleCourse, DeadlineWithCourse } from '../types';
import { api } from '../api/client';

interface MoodleState {
  courses: MoodleCourse[];
  deadlines: DeadlineWithCourse[];
  syncing: boolean;
  loading: boolean;
  error: string | null;
  syncCalendar: (calendarUrl?: string) => Promise<void>;
  fetchCourses: () => Promise<void>;
  fetchDeadlines: (includeCompleted?: boolean) => Promise<void>;
  toggleCompleted: (assignmentId: number) => Promise<void>;
}

export const useMoodleStore = create<MoodleState>((set, get) => ({
  courses: [],
  deadlines: [],
  syncing: false,
  loading: false,
  error: null,

  syncCalendar: async (calendarUrl?: string) => {
    try {
      set({ syncing: true, error: null });
      await api.post('/moodle/sync', calendarUrl ? { calendarUrl } : {});
      await get().fetchCourses();
      await get().fetchDeadlines();
      set({ syncing: false });
    } catch (err: any) {
      set({ error: err.message, syncing: false });
    }
  },

  fetchCourses: async () => {
    try {
      set({ loading: true });
      const { courses } = await api.get<{ courses: MoodleCourse[] }>('/moodle/courses');
      set({ courses, loading: false });
    } catch (err: any) {
      set({ error: err.message, loading: false });
    }
  },

  fetchDeadlines: async (includeCompleted = false) => {
    try {
      const params = includeCompleted ? '?completed=true' : '';
      const { deadlines } = await api.get<{ deadlines: DeadlineWithCourse[] }>(`/moodle/deadlines${params}`);
      set({ deadlines });
    } catch (err: any) {
      set({ error: err.message });
    }
  },

  toggleCompleted: async (assignmentId) => {
    await api.patch(`/moodle/assignments/${assignmentId}/toggle`);
    await get().fetchDeadlines();
  },
}));
