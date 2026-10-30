import { and, eq, inArray, isNull, lt, or, sql } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { googleAccounts, moodleAssignments, moodleCourses, moodleWsTokens, users } from '../db/schema.js';
import { AppError } from '../middleware/errorHandler.js';
import { decrypt, encrypt, verifyState, windowState } from '../utils/crypto.js';
import { MOODLE_URL, cleanGrade, courseCodeOf, launchUrl, parseLaunchLink } from '../utils/moodleToken.js';
import { courseByCode, courseMaterials, goneRows, toDeadline, type WsAssign, type WsCourse, type WsSection, type WsAttempt, type WsDeadline, type WsEvent, type WsQuiz, type WsSubmissionStatus } from '../utils/moodleWs.js';
import { MoodleService } from './moodleService.js';
import { AnalyticsService } from './analyticsService.js';

/*
 * Moodle grades, owner-only experiment (019_moodle_grades.sql). Only read-only web service functions are called;
 * the token is the student's own, from their own sign-in. Not public until KSE IT agrees.
 */

const PASSPORT_PURPOSE = 'moodle-passport';
/** A sign-in started in this window or the one before still fits: 30–60 minutes to copy the link */
const PASSPORT_WINDOW = 30 * 60;
/**
 * Moodle's passport for this student, recomputed by the server rather than kept by the app: Telegram may reload
 * the mini app while the student is in the browser, and anything kept there is gone.
 */
const passports = (userId: number) => [0, 1].map((back) => windowState(userId, PASSPORT_WINDOW, PASSPORT_PURPOSE, back));
/**
 * These and nothing else: reading the student's own courses, grades, calendar, assignment and quiz status.
 * Never submitting, uploading, messaging, posting, starting quizzes or reading private messages (MOODLE-PROMPT.md §2).
 */
const READ_ONLY = [
  'core_webservice_get_site_info', 'core_enrol_get_users_courses', 'gradereport_overview_get_course_grades', 'gradereport_user_get_grade_items',
  'core_calendar_get_calendar_events', 'mod_assign_get_assignments', 'mod_assign_get_submission_status',
  'mod_quiz_get_quizzes_by_courses', 'mod_quiz_get_user_attempts', 'core_course_get_contents',
] as const;
type Fn = (typeof READ_ONLY)[number];
export const isReadOnly = (fn: string): fn is Fn => (READ_ONLY as readonly string[]).includes(fn);

class MoodleWsError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

async function ws<T>(token: string, fn: Fn, params: Record<string, string | number> = {}): Promise<T> {
  if (!isReadOnly(fn)) throw new Error(`Not a read-only Moodle function: ${fn}`);
  const body = new URLSearchParams({ wstoken: token, wsfunction: fn, moodlewsrestformat: 'json' });
  for (const [k, v] of Object.entries(params)) body.set(k, String(v));
  const res = await fetch(`${MOODLE_URL}/webservice/rest/server.php`, { method: 'POST', body, signal: AbortSignal.timeout(15_000) });
  if (!res.ok) throw new MoodleWsError('http', `Moodle HTTP ${res.status}`);
  const data = await res.json() as T & { exception?: string; errorcode?: string; message?: string };
  if (data && typeof data === 'object' && 'exception' in data && data.exception) {
    throw new MoodleWsError(data.errorcode ?? 'unknown', data.message ?? 'Moodle error');
  }
  return data;
}

type SiteInfo = { userid: number; username: string; fullname: string; siteurl: string };

const DAY_S = 86_400;
/** A connected student's deadlines are read again this often (the cron ticks every ~10 minutes) */
export const DEADLINES_SYNC_EVERY = 15 * 60_000;
const DEADLINES_PER_TICK = 5;
/** Moodle answers each assignment's and quiz's status separately: the nearest ones, a few at a time */
const STATUS_CALLS = 30;
const STATUS_CONCURRENCY = 4;
/** What the calendar link calls events outside any course (DeadlinesPage folds them away) */
const GENERAL = 'General / University';

/** Every graded item of one course with its grade, percentage and the teacher's feedback; the course total apart. */
async function gradeItems(token: string, moodleUserId: number, courseId: number) {
  const r = await ws<{ usergrades: { gradeitems: {
    id: number; itemname: string | null; itemtype: string; gradeformatted?: string; percentageformatted?: string;
    feedback?: string; gradedatesubmitted?: number | null; gradedategraded?: number | null;
  }[] }[] }>(token, 'gradereport_user_get_grade_items', { courseid: courseId, userid: moodleUserId });
  const items = r.usergrades[0]?.gradeitems ?? [];
  // The user report writes "29.28" where the overview writes "29,28": one way in the app
  const grade = (g: string | undefined) => cleanGrade(g)?.replace(/(\d)\.(\d)/g, '$1,$2') ?? null;
  return {
    total: grade(items.find((i) => i.itemtype === 'course')?.gradeformatted),
    items: items.filter((i) => i.itemtype !== 'course' && i.itemtype !== 'category').map((i) => ({
      id: i.id,
      name: i.itemname ?? '',
      grade: grade(i.gradeformatted),
      percent: grade(i.percentageformatted),
      feedback: cleanGrade(i.feedback),
      gradedAt: i.gradedategraded ? new Date(i.gradedategraded * 1000).toISOString() : null,
    })),
  };
}

async function inBatches<T, R>(items: T[], size: number, fn: (item: T) => Promise<R>) {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...await Promise.all(items.slice(i, i + size).map(fn)));
  return out;
}

export class MoodleGradesService {
  /** The sign-in page link, with a passport tied to this student for 30 minutes. */
  static start(userId: number) {
    return { url: launchUrl(passports(userId)[0]) };
  }

  /** The link the student copied → a checked token: right site, right person, then stored encrypted. */
  static async connect(userId: number, link: string, legacyPassport?: string) {
    // This student's passports for now and the window before; an older app may still send the one it kept
    const candidates = [...passports(userId), ...(legacyPassport && verifyState(legacyPassport, PASSPORT_PURPOSE) === userId ? [legacyPassport] : [])];
    const results = candidates.map((p) => parseLaunchLink(link, p));
    const parsed = results.find((r) => 'token' in r) ?? results[0];
    if ('error' in parsed) {
      throw new AppError(parsed.error === 'other_site'
        ? 'Посилання з іншого входу або вже застаріло. Натисни «Відкрити Moodle» ще раз і скопіюй нове.'
        : 'Не бачу токена в посиланні. Скопіюй посилання «Натисніть тут…» цілком.', 400);
    }
    const info = await ws<SiteInfo>(parsed.token, 'core_webservice_get_site_info').catch(() => {
      throw new AppError('Moodle не прийняв цей вхід. Спробуй ще раз.', 400);
    });
    if (info.siteurl.replace(/\/$/, '') !== MOODLE_URL) throw new AppError('Це не Moodle KSE.', 400);
    // The Moodle account must be this student's: the same KSE email as their Google sign-in here
    const [account] = await db.select({ email: googleAccounts.email }).from(googleAccounts).where(eq(googleAccounts.userId, userId)).limit(1);
    if (!account || !sameKsePerson(info.username, account.email)) {
      throw new AppError('Це не твій акаунт Moodle: увійди в Moodle тією ж поштою KSE, що й у KSE Hub.', 403);
    }
    await db.insert(moodleWsTokens).values({ userId, tokenEnc: encrypt(parsed.token), moodleUserId: info.userid, lastOkAt: new Date() })
      .onConflictDoUpdate({ target: moodleWsTokens.userId, set: { tokenEnc: encrypt(parsed.token), moodleUserId: info.userid, lastOkAt: new Date() } });
    // Deadlines come with the same sign-in: the first read right away, the cron keeps them fresh
    await this.syncDeadlines(userId).catch((err) => console.error(`Moodle deadlines failed for user ${userId}:`, err));
    return { connected: true, name: info.fullname };
  }

  static async disconnect(userId: number) {
    await db.delete(moodleWsTokens).where(eq(moodleWsTokens.userId, userId));
    return { connected: false };
  }

  /** Token or null; a token Moodle no longer accepts is forgotten. */
  private static async session(userId: number) {
    const [row] = await db.select().from(moodleWsTokens).where(eq(moodleWsTokens.userId, userId)).limit(1);
    return row ? { token: decrypt(row.tokenEnc), moodleUserId: row.moodleUserId } : null;
  }

  private static async call<T>(userId: number, fn: (s: { token: string; moodleUserId: number }) => Promise<T>) {
    const s = await this.session(userId);
    if (!s) return null;
    try {
      const out = await fn(s);
      await db.update(moodleWsTokens).set({ lastOkAt: new Date() }).where(eq(moodleWsTokens.userId, userId));
      return out;
    } catch (e) {
      if (e instanceof MoodleWsError && /invalidtoken|accessexception/i.test(e.code)) {
        await this.disconnect(userId);
        return null;
      }
      throw new AppError('Moodle не відповідає. Спробуй за хвилину.', 502);
    }
  }

  /** Every course with its total, as the gradebook overview shows it. */
  static async overview(userId: number) {
    const out = await this.call(userId, async ({ token, moodleUserId }) => {
      const [courses, grades] = await Promise.all([
        ws<WsCourse[]>(token, 'core_enrol_get_users_courses', { userid: moodleUserId }),
        ws<{ grades: { courseid: number; grade: string; rawgrade: string | null }[] }>(token, 'gradereport_overview_get_course_grades', { userid: moodleUserId }),
      ]);
      const byId = new Map(grades.grades.map((g) => [g.courseid, g]));
      return courses.map((c) => ({
        courseId: c.id,
        code: courseCodeOf(c.shortname, c.fullname),
        name: c.fullname,
        grade: cleanGrade(byId.get(c.id)?.grade),
        // Moodle's end date passed: folded under «Минулі курси»
        ended: !!c.enddate && c.enddate * 1000 < Date.now(),
      })).sort((a, b) => Number(!!b.grade) - Number(!!a.grade) || a.name.localeCompare(b.name));
    });
    if (!out) return { connected: false, courses: [], deadlinesSyncedAt: null };
    const [row] = await db.select({ at: moodleWsTokens.deadlinesSyncedAt }).from(moodleWsTokens).where(eq(moodleWsTokens.userId, userId)).limit(1);
    return { connected: true, courses: out, deadlinesSyncedAt: row?.at ?? null };
  }

  static async isConnected(userId: number) {
    const [row] = await db.select({ userId: moodleWsTokens.userId }).from(moodleWsTokens).where(eq(moodleWsTokens.userId, userId)).limit(1);
    return !!row;
  }

  /**
   * Deadlines and quizzes from Moodle itself, in place of the calendar link: the calendar's own events (same ids
   * as the export, so the same rows), each assignment's "submitted" and extension, each quiz's attempts.
   * Null when Moodle isn't connected (or no longer accepts the token).
   */
  static async syncDeadlines(userId: number, now = new Date()) {
    const items = await this.call(userId, async ({ token, moodleUserId }) => {
      const courses = await ws<{ id: number; shortname: string }[]>(token, 'core_enrol_get_users_courses', { userid: moodleUserId });
      if (!courses.length) return [];
      const t = Math.floor(now.getTime() / 1000);
      const ids: Record<string, number> = {};
      const cal: Record<string, number> = { 'options[userevents]': 1, 'options[siteevents]': 1, 'options[timestart]': t - 14 * DAY_S, 'options[timeend]': t + 120 * DAY_S };
      courses.forEach((c, i) => { ids[`courseids[${i}]`] = c.id; cal[`events[courseids][${i}]`] = c.id; });
      const [{ events }, assigns, { quizzes }] = await Promise.all([
        ws<{ events: WsEvent[] }>(token, 'core_calendar_get_calendar_events', cal),
        ws<{ courses: { assignments: WsAssign[] }[] }>(token, 'mod_assign_get_assignments', ids),
        ws<{ quizzes: WsQuiz[] }>(token, 'mod_quiz_get_quizzes_by_courses', ids),
      ]);
      const assignById = new Map(assigns.courses.flatMap((c) => c.assignments).map((a) => [a.id, a]));
      const quizById = new Map(quizzes.map((q) => [q.id, q]));

      // Statuses for the activities nearest to now; one that fails just goes without
      const wanted = new Map<string, { mod: 'assign' | 'quiz'; id: number }>();
      for (const e of [...events].sort((a, b) => Math.abs(a.timestart - t) - Math.abs(b.timestart - t))) {
        if ((e.modulename === 'assign' || e.modulename === 'quiz') && e.instance && e.eventtype !== 'open') {
          wanted.set(`${e.modulename}:${e.instance}`, { mod: e.modulename, id: e.instance });
        }
      }
      const statuses = new Map<string, WsSubmissionStatus | WsAttempt[]>();
      await inBatches([...wanted].slice(0, STATUS_CALLS), STATUS_CONCURRENCY, async ([key, { mod, id }]) => {
        const got = mod === 'assign'
          ? await ws<WsSubmissionStatus>(token, 'mod_assign_get_submission_status', { assignid: id }).catch(() => null)
          : await ws<{ attempts: WsAttempt[] }>(token, 'mod_quiz_get_user_attempts', { quizid: id, status: 'all' }).then((r) => r.attempts).catch(() => null);
        if (got) statuses.set(key, got);
      });

      const courseName = new Map(courses.map((c) => [c.id, c.shortname.trim()]));
      return events.flatMap((e) => {
        const key = `${e.modulename}:${e.instance}`;
        const d = toDeadline(e, e.modulename === 'assign'
          ? { assign: assignById.get(e.instance!), status: statuses.get(key) as WsSubmissionStatus | undefined }
          : e.modulename === 'quiz' ? { quiz: quizById.get(e.instance!), attempts: statuses.get(key) as WsAttempt[] | undefined } : {});
        return d ? [{ ...d, courseName: courseName.get(e.courseid) ?? GENERAL }] : [];
      });
    });
    if (!items) return null;
    await this.storeDeadlines(userId, items, now);
    await db.update(moodleWsTokens).set({ deadlinesSyncedAt: now }).where(eq(moodleWsTokens.userId, userId));
    return { deadlines: items.length };
  }

  /** Same rows as the calendar link wrote (by event id); Moodle's "submitted" marks done, a manual tick is never undone. */
  private static async storeDeadlines(userId: number, items: (WsDeadline & { courseName: string })[], now: Date) {
    const courseIds = new Map((await db.select({ id: moodleCourses.id, name: moodleCourses.courseName })
      .from(moodleCourses).where(eq(moodleCourses.userId, userId))).map((c) => [c.name, c.id]));
    for (const name of new Set(items.map((i) => i.courseName))) {
      if (courseIds.has(name)) continue;
      // The same pseudo id the calendar sync gives a course
      const [row] = await db.insert(moodleCourses).values({ userId, courseId: Buffer.from(name).toString('base64').slice(0, 16), courseName: name, syncedAt: now })
        .returning({ id: moodleCourses.id });
      courseIds.set(name, row.id);
    }

    const existing = await db.select({ id: moodleAssignments.id, externalId: moodleAssignments.externalId, dueDate: moodleAssignments.dueDate, isCompleted: moodleAssignments.isCompleted })
      .from(moodleAssignments).where(eq(moodleAssignments.userId, userId));
    const byExternalId = new Map(existing.map((r) => [r.externalId, r]));
    for (const it of items) {
      const values = {
        courseId: courseIds.get(it.courseName)!, title: it.title, dueDate: it.dueDate, sourceUrl: it.sourceUrl, type: it.type, moodle: it.moodle,
        ...(it.submittedAt ? { submittedAt: it.submittedAt, isCompleted: true } : {}),
      };
      const row = byExternalId.get(it.externalId);
      if (!row) {
        await db.insert(moodleAssignments).values({ userId, externalId: it.externalId, ...values });
        continue;
      }
      await db.update(moodleAssignments).set(values).where(eq(moodleAssignments.id, row.id));
      if (it.submittedAt && !row.isCompleted) AnalyticsService.track(userId, 'deadline.done', { via: 'moodle' });
    }

    const gone = goneRows(existing, new Set(items.map((i) => i.externalId)), now);
    if (gone.length) await db.delete(moodleAssignments).where(inArray(moodleAssignments.id, gone.map((r) => r.id)));
    await MoodleService.refreshVisibility(userId);
  }

  /** Cron: connected admins whose deadlines are the most out of date. Owner-only until the owner opens it to everyone. */
  static async syncDueDeadlines(now = new Date()) {
    const due = await db.select({ userId: moodleWsTokens.userId }).from(moodleWsTokens)
      .innerJoin(users, eq(users.id, moodleWsTokens.userId))
      .where(and(
        eq(users.isAdmin, true),
        or(isNull(moodleWsTokens.deadlinesSyncedAt), lt(moodleWsTokens.deadlinesSyncedAt, new Date(now.getTime() - DEADLINES_SYNC_EVERY))),
      ))
      .orderBy(sql`${moodleWsTokens.deadlinesSyncedAt} asc nulls first`)
      .limit(DEADLINES_PER_TICK);
    let synced = 0;
    for (const { userId } of due) {
      try {
        if (await this.syncDeadlines(userId, now)) synced++;
      } catch (err) {
        console.error(`Moodle deadlines failed for user ${userId}:`, err);
        // Marked anyway so one broken account doesn't hold the queue
        await db.update(moodleWsTokens).set({ deadlinesSyncedAt: now }).where(eq(moodleWsTokens.userId, userId));
      }
    }
    return synced;
  }

  /** One course: every graded item with its grade, percentage and the teacher's feedback. */
  static async course(userId: number, courseId: number) {
    const out = await this.call(userId, ({ token, moodleUserId }) => gradeItems(token, moodleUserId, courseId));
    if (!out) throw new AppError('Moodle відключено. Підключи ще раз.', 404);
    return out;
  }

  /** Навчання → Курси → a course: its grades with feedback and its materials, section by section. */
  static async coursePage(userId: number, code: string) {
    const out = await this.call(userId, async ({ token, moodleUserId }) => {
      const course = courseByCode(await ws<WsCourse[]>(token, 'core_enrol_get_users_courses', { userid: moodleUserId }), code);
      // Not in this student's Moodle: undefined, apart from null = not connected
      if (!course) return undefined;
      const [grades, contents] = await Promise.all([
        gradeItems(token, moodleUserId, course.id),
        // excludecontents: the outline without file lists, so no file URL (and no token) ever comes back
        ws<WsSection[]>(token, 'core_course_get_contents', { courseid: course.id, 'options[0][name]': 'excludecontents', 'options[0][value]': 1 }),
      ]);
      return { courseId: course.id, name: course.fullname, url: `${MOODLE_URL}/course/view.php?id=${course.id}`, grades, sections: courseMaterials(contents) };
    });
    if (out === null) return { connected: false as const };
    if (!out) throw new AppError('Цього курсу немає в твоєму Moodle', 404);
    return { connected: true as const, ...out };
  }
}

/** Moodle username "ivan.petrenko.26@kse.org.ua" (or just "ivan.petrenko.26") vs the Google email in KSE Hub */
export function sameKsePerson(moodleUsername: string, email: string) {
  const u = moodleUsername.trim().toLowerCase();
  const e = email.trim().toLowerCase();
  return u === e || u === e.split('@')[0];
}
