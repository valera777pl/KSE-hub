import type { MoodleExtra } from '../db/schema.js';
import { MOODLE_URL, cleanGrade, courseCodeOf } from './moodleToken.js';

/*
 * Deadlines straight from Moodle through the student's own token (owner-only for now). Moodle's calendar
 * (core_calendar_get_calendar_events) already shows only what this student can see — their own practice
 * group's copy, no hidden activities — and its event ids are the ones in the calendar export, so a row
 * written here is the same row the calendar link wrote before: reminders and friends' reminders stay attached.
 */

/** "39768@teaching.kse.org.ua": the UID the calendar export gives the same event */
export const eventExternalId = (eventId: number, wwwroot = MOODLE_URL) => `${eventId}@${new URL(wwwroot).host}`;

export type WsEvent = {
  id: number; name: string; courseid: number; modulename?: string | null; instance?: number | null;
  eventtype: string; timestart: number;
};
export type WsAssign = { id: number; cmid: number; duedate: number; cutoffdate: number };
type WsSubmission = { status: string; timemodified: number };
export type WsSubmissionStatus = {
  lastattempt?: { submission?: WsSubmission; teamsubmission?: WsSubmission; extensionduedate?: number | null };
  feedback?: { gradefordisplay?: string };
};
export type WsQuiz = { id: number; coursemodule: number; timeopen: number; timeclose: number; attempts: number; grade: number; sumgrades: number | null; decimalpoints: number };
export type WsAttempt = { state: string; sumgrades: number | null; timefinish: number };

export type WsDeadline = {
  externalId: string;
  title: string;
  courseId: number;
  type: 'assignment' | 'quiz' | 'event';
  dueDate: Date;
  sourceUrl: string;
  /** Moodle says it's handed in (assignment) or a quiz attempt is finished */
  submittedAt: Date | null;
  moodle: MoodleExtra;
};

const at = (s: number | null | undefined) => (s ? new Date(s * 1000) : null);
const iso = (s: number | null | undefined) => at(s)?.toISOString() ?? null;
/** 17.5 → "17,5"; 1 → "1": as Moodle shows Ukrainian grades, without trailing zeros */
const num = (n: number, dp: number) => String(Number(n.toFixed(Math.max(0, dp)))).replace('.', ',');

/** The student's best finished quiz attempt, on the quiz's own scale: "8,5 / 10". Null when Moodle hides the marks. */
export function quizGrade(quiz: WsQuiz, attempts: WsAttempt[]) {
  const marks = attempts.filter((a) => a.state === 'finished' && a.sumgrades != null).map((a) => a.sumgrades!);
  if (!marks.length || !quiz.sumgrades) return null;
  return `${num((Math.max(...marks) / quiz.sumgrades) * quiz.grade, quiz.decimalpoints)} / ${num(quiz.grade, quiz.decimalpoints)}`;
}

/**
 * One calendar event → one deadline row. "Opens" events become `opensAt` of their quiz instead of a row of their own.
 * Only the facts from Moodle; whether a row is shown is still decided by MoodleService.refreshVisibility.
 */
export function toDeadline(ev: WsEvent, ctx: { assign?: WsAssign; status?: WsSubmissionStatus; quiz?: WsQuiz; attempts?: WsAttempt[] } = {}, wwwroot = MOODLE_URL): WsDeadline | null {
  if (ev.eventtype === 'open') return null;
  const mod = ev.modulename ?? null;
  const cmid = ctx.assign?.cmid ?? ctx.quiz?.coursemodule;
  const base = {
    externalId: eventExternalId(ev.id, wwwroot),
    title: ev.name,
    courseId: ev.courseid,
    dueDate: at(ev.timestart)!,
    sourceUrl: mod && cmid ? `${wwwroot}/mod/${mod}/view.php?id=${cmid}` : `${wwwroot}/calendar/view.php?view=day&time=${ev.timestart}#event_${ev.id}`,
  };

  if (mod === 'assign') {
    const last = ctx.status?.lastattempt;
    const sub = last?.submission ?? last?.teamsubmission;
    const extension = last?.extensionduedate && last.extensionduedate > ev.timestart ? last.extensionduedate : null;
    return {
      ...base,
      type: 'assignment',
      dueDate: at(extension ?? ev.timestart)!,
      submittedAt: sub?.status === 'submitted' ? at(sub.timemodified) : null,
      moodle: {
        cutoff: ctx.assign?.cutoffdate ? iso(ctx.assign.cutoffdate) : null,
        extendedFrom: extension ? iso(ev.timestart) : null,
        grade: cleanGrade(ctx.status?.feedback?.gradefordisplay),
      },
    };
  }

  if (mod === 'quiz') {
    const attempts = ctx.attempts ?? [];
    const finished = attempts.filter((a) => a.state === 'finished');
    return {
      ...base,
      type: 'quiz',
      submittedAt: finished.length ? at(Math.max(...finished.map((a) => a.timefinish))) : null,
      moodle: {
        opensAt: ctx.quiz?.timeopen ? iso(ctx.quiz.timeopen) : null,
        attemptsUsed: finished.length,
        attemptsAllowed: ctx.quiz?.attempts ?? 0,
        grade: ctx.quiz ? quizGrade(ctx.quiz, attempts) : null,
      },
    };
  }

  return { ...base, type: 'event', submittedAt: null, moodle: {} };
}

/**
 * Rows Moodle no longer has: still ahead, but not in what Moodle just returned (the teacher removed the event,
 * or it was never the student's). Past rows stay as history. Nothing goes when Moodle returned nothing at all.
 */
export function goneRows<T extends { id: number; externalId: string | null; dueDate: Date | null }>(rows: T[], seen: Set<string>, now: Date) {
  if (!seen.size) return [];
  return rows.filter((r) => r.dueDate && r.dueDate > now && !seen.has(r.externalId ?? ''));
}

/* ─── The course page: the student's course by its code, and its materials section by section ─── */

export type WsCourse = { id: number; shortname: string; fullname: string; enddate?: number };

/** "MATH101" → the Moodle course whose short or full name carries that code (MATH101 is not MATH111) */
export const courseByCode = <T extends WsCourse>(courses: T[], code: string) =>
  courses.find((c) => courseCodeOf(c.shortname, c.fullname) === code) ?? null;

export type WsModule = { id: number; name: string; modname: string; uservisible?: boolean; noviewlink?: boolean };
export type WsSection = { id: number; name: string; section: number; uservisible?: boolean; modules: WsModule[] };
export type Material = { id: number; name: string; kind: string; url: string };

/** Teachers start names with emoji ("🧑‍🏫 (L) 01.10 Online"); the app shows the words */
const stripLeadingEmoji = (s: string) => s.replace(/^[\p{Extended_Pictographic}\p{Emoji_Modifier}‍️\s]+/u, '').trim() || s.trim();

/**
 * Moodle's course outline → what the student can open: sections with their files, links, pages and activities.
 * Text labels, things hidden from the student and empty sections are left out. Every link is the activity's
 * own Moodle page (the student signs in there as usual): never a file URL with the token in it.
 */
export function courseMaterials(sections: WsSection[], wwwroot = MOODLE_URL) {
  return sections
    .filter((s) => s.uservisible !== false)
    .map((s) => ({
      name: s.name.trim(),
      items: s.modules
        .filter((m) => m.modname !== 'label' && m.uservisible !== false && !m.noviewlink)
        .map((m): Material => ({ id: m.id, name: stripLeadingEmoji(m.name), kind: m.modname, url: `${wwwroot}/mod/${m.modname}/view.php?id=${m.id}` })),
    }))
    .filter((s) => s.items.length);
}
