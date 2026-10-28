/*
 * "Moodle without noise". Teachers copy every quiz once per practice group
 * ("Квіз 5 · Заняття 12 · Група 7 закривається"), so one quiz reaches a student as six deadlines.
 * The student's own group is the number of their practice section in the schedule: MATH101 [P8] → Група 8.
 * The rule is per student and per course; when we can't tell, nothing is hidden.
 */

/** Course code → this student's practice group numbers: { MATH101: [8] } from MATH101 [P8]. */
export type Groups = Map<string, number[]>;

export function practiceGroups(sections: { courseCode: string; section: string | null }[]): Groups {
  const groups: Groups = new Map();
  for (const { courseCode, section } of sections) {
    const n = section?.trim().match(/^[PР]\s*0*(\d{1,2})$/i)?.[1];
    if (!n) continue;
    groups.set(courseCode, [...(groups.get(courseCode) ?? []), Number(n)]);
  }
  return groups;
}

/** "MATH101 (2026-2027)-Тест" → "MATH101" */
export function courseCodeIn(text: string | null | undefined): string | null {
  const m = text?.match(/\b([A-Z]{2,6})\s?(\d{3}[A-Z]?)\b/);
  return m ? `${m[1]}${m[2]}` : null;
}

/** "… · Група 7 закривається" → 7 */
export function groupIn(text: string): number | null {
  const m = text.match(/(?:груп[аиі]|group)\s*№?\s*0*(\d{1,2})\b/i);
  return m ? Number(m[1]) : null;
}

/** True when the text names a practice group of the course that isn't this student's. */
export function isOtherGroup(text: string, courseHint: string | null | undefined, groups: Groups): boolean {
  const n = groupIn(text);
  if (n === null) return false;
  const code = courseCodeIn(courseHint) ?? courseCodeIn(text);
  const mine = code ? groups.get(code) : undefined;
  return !!mine?.length && !mine.includes(n);
}

// What Moodle appends to an activity's name in the calendar export
const STATUS = /\s*(?:[-–—:·]\s*)?(?:opens|closes|is due|due|відкривається|закривається|відкрито|закрито|відкриття|закриття|термін здачі|має бути виконано|should be completed)\.?\s*$/i;
const OPENS = /(?:opens|відкривається|відкрито|відкриття)\.?\s*$/i;

/** The activity's own name: no "(MATH101 …)" prefix, no "closes / закрито", lower case. */
export function activityName(title: string): string {
  return title
    .replace(/^\s*\((?:[^()]|\([^()]*\))*\)\s*/, '')
    .replace(STATUS, '')
    .replace(/[«»"“”'‘’]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

type Row = { id: number; title: string; courseName: string | null; dueDate: Date | null };

/**
 * Which of a student's Moodle items to hide: no due date (Debate, Participation), the "opens" half of a quiz,
 * another practice group's copy, and the second of two entries for the same thing ("closes" and "закрито").
 */
export function visibility(rows: Row[], groups: Groups): Map<number, { hidden: boolean; groupNo: number | null }> {
  const out = new Map<number, { hidden: boolean; groupNo: number | null }>();
  const seen = new Set<string>();
  const ordered = [...rows].sort((a, b) => (a.dueDate?.getTime() ?? 0) - (b.dueDate?.getTime() ?? 0) || a.id - b.id);
  for (const r of ordered) {
    const groupNo = groupIn(r.title);
    let hidden = !r.dueDate || OPENS.test(r.title.trim()) || isOtherGroup(r.title, r.courseName, groups);
    if (!hidden) {
      // Same activity, same hour: one entry
      const key = `${courseCodeIn(r.courseName) ?? r.courseName ?? ''}|${activityName(r.title)}|${Math.floor(r.dueDate!.getTime() / 3_600_000)}`;
      if (seen.has(key)) hidden = true;
      seen.add(key);
    }
    out.set(r.id, { hidden, groupNo });
  }
  return out;
}

/* ─── Moodle mail: "submitted" receipts and feedback (only two states, no drafts) ─── */

export type MoodleMail = { kind: 'submitted' | 'feedback'; title: string; courseCode: string | null };

const Q = `['"«“‘]`;
const QE = `['"»”’]`;
const FEEDBACK = [
  new RegExp(`дав(?:ла)? відгук .*?завдання\\s*${Q}(.+?)${QE}`, 'i'),
  new RegExp(`feedback .*?${Q}(.+?)${QE}`, 'i'),
];
const SUBMITTED = [
  new RegExp(`здали роботу на завдання\\s*${Q}(.+?)${QE}`, 'i'),
  new RegExp(`(?:submitted|submission) .*?${Q}(.+?)${QE}`, 'i'),
];

/** Recognise Moodle's receipt and feedback emails; the course code comes from the breadcrumbs "MATH111 EBD, BE 30 -> Завдання -> Homework 1". */
export function parseMoodleMail(subject: string, body: string): MoodleMail | null {
  const crumbs = body.split('\n').find((line) => line.includes('->'));
  const courseCode = courseCodeIn(crumbs) ?? courseCodeIn(subject);
  for (const re of FEEDBACK) {
    const m = subject.match(re);
    if (m) return { kind: 'feedback', title: m[1].trim(), courseCode };
  }
  for (const re of SUBMITTED) {
    const m = subject.match(re);
    if (m) return { kind: 'submitted', title: m[1].trim(), courseCode };
  }
  return null;
}

/** The assignment a receipt or feedback is about: same name (and course when known), due nearest to the email. */
export function matchAssignment(mail: MoodleMail, rows: Row[], at: Date): number | null {
  const name = activityName(mail.title);
  const candidates = rows.filter((r) =>
    activityName(r.title) === name && (!mail.courseCode || !courseCodeIn(r.courseName) || courseCodeIn(r.courseName) === mail.courseCode));
  if (!candidates.length) return null;
  const distance = (r: Row) => Math.abs((r.dueDate?.getTime() ?? 0) - at.getTime());
  return candidates.sort((a, b) => distance(a) - distance(b))[0].id;
}
