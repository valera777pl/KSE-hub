import { tr } from './i18n';

/* How a class location reads in the app: building and room in Latin as KSE writes them, no sponsor room names (DESIGN.md). */

/**
 * "M. Shpaka 3, 2.15.1 Roy Gartner Memorial Classroom" → "M. Shpaka 3, 2.15.1": the building in Latin,
 * as the schedule source writes it, and the room number; sponsor names of rooms are dropped.
 */
export function shortPlace(location: string | null): string | null {
  if (!location) return null;
  if (/^online$/i.test(location.trim())) return tr('Онлайн', 'Online');
  const [building, rest] = location.split(/,\s*/, 2);
  const room = rest?.trim().split(/\s+/)[0];
  return room ? `${building.trim()}, ${room}` : building.trim();
}

/** "P6" → "Практика", "L1" → "Лекція" */
export const classKind = (section: string | null) =>
  section?.startsWith('L') ? tr('Лекція', 'Lecture') : section?.startsWith('P') ? tr('Практика', 'Practice') : section?.startsWith('S') ? tr('Семінар', 'Seminar') : null;

/** "Данило Гнатенко" → "ДГ"; one letter when there's one word */
export const initials = (name: string) =>
  name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
