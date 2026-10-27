import type { ClassEvent } from '../types';
import { tr } from './i18n';

/* A student's programme isn't stored anywhere at KSE we can read, but course titles carry it:
   "English for Professional and Study Purposes I (BE, EBD)". */

const NAMES: Record<string, [string, string]> = {
  BE: ['Business Economics', 'Business Economics'],
  EBD: ['Economics and Big Data', 'Economics and Big Data'],
};

export const programName = (code: string) => (NAMES[code] ? tr(NAMES[code][0], NAMES[code][1]) : code);

/** Programmes named in the student's course titles, most frequent first (ties keep title order). */
export function programsFromSchedule(events: ClassEvent[]): string[] {
  const count = new Map<string, number>();
  for (const title of new Set(events.map((e) => e.title))) {
    const tags = title.match(/\(([^()]*)\)\s*$/)?.[1].split(/[,;/\s]+/) ?? [];
    for (const tag of tags) if (/^[A-Z]{2,5}$/.test(tag)) count.set(tag, (count.get(tag) ?? 0) + 1);
  }
  return [...count.entries()].sort((a, b) => b[1] - a[1]).map(([code]) => code);
}

/** "valerii.pletmintsev.26@kse.org.ua" → 2026: the number is the year of entry. */
export function cohortFromEmail(email: string | null | undefined): number | null {
  const m = email?.match(/\.(\d{2})@kse\.org\.ua$/i);
  return m ? 2000 + Number(m[1]) : null;
}

/** Year of study from the entry year; the academic year turns over on 1 September. */
export function courseYear(cohort: number, today = new Date()) {
  const academicStart = today.getMonth() >= 8 ? today.getFullYear() : today.getFullYear() - 1;
  return academicStart - cohort + 1;
}
