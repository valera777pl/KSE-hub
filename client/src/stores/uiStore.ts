import { create } from 'zustand';
import type { TabId } from '../types';

/** App-level navigation: which tab is open and what a deep link asked for. */
interface UiState {
  tab: TabId;
  studyView: 'schedule' | 'deadlines';
  scheduleDay: string | null;
  deadlineId: number | null;
  profileOpen: boolean;
  setTab: (tab: TabId) => void;
  setStudyView: (v: 'schedule' | 'deadlines') => void;
  openDay: (day: string) => void;
  openDeadline: (id: number) => void;
  openProfile: () => void;
  closeProfile: () => void;
}

export const useUi = create<UiState>((set) => ({
  tab: 'today',
  studyView: 'schedule',
  scheduleDay: null,
  deadlineId: null,
  profileOpen: false,
  setTab: (tab) => set({ tab }),
  setStudyView: (studyView) => set({ studyView }),
  openDay: (scheduleDay) => set({ tab: 'study', studyView: 'schedule', scheduleDay }),
  openDeadline: (deadlineId) => set({ tab: 'study', studyView: 'deadlines', deadlineId }),
  openProfile: () => set({ profileOpen: true }),
  closeProfile: () => set({ profileOpen: false }),
}));

/** startapp=today | day_2026-10-27 | deadline_12 | booking_5 | opps | opp_3 */
export function applyStartParam(param: string | null) {
  if (!param) return;
  const s = useUi.getState();
  const [kind, value] = [param.split('_')[0], param.slice(param.indexOf('_') + 1)];
  if (kind === 'day' && /^\d{4}-\d{2}-\d{2}$/.test(value)) s.openDay(value);
  else if (kind === 'deadline' && Number(value)) s.openDeadline(Number(value));
  else if (kind === 'booking') s.setTab('rooms');
  else if (kind === 'opps' || kind === 'opp') s.setTab('opps');
  else s.setTab('today');
}
