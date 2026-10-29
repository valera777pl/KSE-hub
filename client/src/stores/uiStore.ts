import { create } from 'zustand';
import type { ClassEvent, TabId } from '../types';

export type OppsView = 'forYou' | 'events' | 'startups' | 'people';

/** App-level navigation: which tab is open and what a deep link asked for. */
interface UiState {
  tab: TabId;
  studyView: 'schedule' | 'deadlines';
  scheduleDay: string | null;
  deadlineId: number | null;
  profileOpen: boolean;
  oppsView: OppsView;
  oppId: number | null;
  eventId: number | null;
  /** The course page over the current tab: "ECON100" */
  courseCode: string | null;
  /** The class the course page was opened from (a tap in the grid or on «Зараз»), shown on top */
  courseFocus: ClassEvent | null;
  openCourse: (code: string, focus?: ClassEvent | null) => void;
  closeCourse: () => void;
  setOppsView: (v: OppsView) => void;
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
  oppsView: 'forYou',
  oppId: null,
  eventId: null,
  courseCode: null,
  courseFocus: null,
  openCourse: (courseCode, focus = null) => set({ courseCode, courseFocus: focus }),
  closeCourse: () => set({ courseCode: null, courseFocus: null }),
  setOppsView: (oppsView) => set({ oppsView }),
  setTab: (tab) => set({ tab }),
  setStudyView: (studyView) => set({ studyView }),
  openDay: (scheduleDay) => set({ tab: 'study', studyView: 'schedule', scheduleDay }),
  openDeadline: (deadlineId) => set({ tab: 'study', studyView: 'deadlines', deadlineId }),
  openProfile: () => set({ profileOpen: true }),
  closeProfile: () => set({ profileOpen: false }),
}));

/**
 * A bot button's startapp carries the push type after "__": "deadline_12__d24", "day_2026-10-29__digest".
 * Returns the screen part, the kind of screen (no ids) and the push type for analytics.
 */
export function splitStartParam(raw: string | null): { param: string | null; kind: string | null; push: string | null } {
  if (!raw) return { param: null, kind: null, push: null };
  const [param, push] = raw.split('__');
  return { param: param || null, kind: param ? param.split('_')[0] : null, push: push || null };
}

/** startapp=today | day_2026-10-27 | deadlines | deadline_12 | booking_5 | opps | opp_3 | event_7 | course_ECON100 */
export function applyStartParam(param: string | null) {
  if (!param) return;
  const s = useUi.getState();
  const [kind, value] = [param.split('_')[0], param.slice(param.indexOf('_') + 1)];
  if (kind === 'day' && /^\d{4}-\d{2}-\d{2}$/.test(value)) s.openDay(value);
  else if (kind === 'deadline' && Number(value)) s.openDeadline(Number(value));
  else if (kind === 'deadlines') useUi.setState({ tab: 'study', studyView: 'deadlines' });
  else if (kind === 'booking') s.setTab('rooms');
  else if (kind === 'opp' && Number(value)) useUi.setState({ tab: 'opps', oppsView: 'forYou', oppId: Number(value) });
  else if (kind === 'event' && Number(value)) useUi.setState({ tab: 'opps', oppsView: 'events', eventId: Number(value) });
  else if (kind === 'course' && /^[A-Z]{2,6}\d{3}[A-Z]?$/.test(value)) s.openCourse(value);
  else if (kind === 'opps') s.setTab('opps');
  else s.setTab('today');
}
