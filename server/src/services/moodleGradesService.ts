import { eq } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { googleAccounts, moodleWsTokens } from '../db/schema.js';
import { AppError } from '../middleware/errorHandler.js';
import { decrypt, encrypt, verifyState, windowState } from '../utils/crypto.js';
import { MOODLE_URL, cleanGrade, courseCodeOf, launchUrl, parseLaunchLink } from '../utils/moodleToken.js';

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
/** These and nothing else: reading the student's own courses and grades */
const READ_ONLY = ['core_webservice_get_site_info', 'core_enrol_get_users_courses', 'gradereport_overview_get_course_grades', 'gradereport_user_get_grade_items'] as const;
type Fn = (typeof READ_ONLY)[number];

class MoodleWsError extends Error {
  constructor(public code: string, message: string) { super(message); }
}

async function ws<T>(token: string, fn: Fn, params: Record<string, string | number> = {}): Promise<T> {
  if (!READ_ONLY.includes(fn)) throw new Error(`Not a read-only Moodle function: ${fn}`);
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
        ws<{ id: number; shortname: string; fullname: string }[]>(token, 'core_enrol_get_users_courses', { userid: moodleUserId }),
        ws<{ grades: { courseid: number; grade: string; rawgrade: string | null }[] }>(token, 'gradereport_overview_get_course_grades', { userid: moodleUserId }),
      ]);
      const byId = new Map(grades.grades.map((g) => [g.courseid, g]));
      return courses.map((c) => ({
        courseId: c.id,
        code: courseCodeOf(c.shortname, c.fullname),
        name: c.fullname,
        grade: cleanGrade(byId.get(c.id)?.grade),
      })).sort((a, b) => Number(!!b.grade) - Number(!!a.grade) || a.name.localeCompare(b.name));
    });
    return out ? { connected: true, courses: out } : { connected: false, courses: [] };
  }

  /** One course: every graded item with its grade, percentage and the teacher's feedback. */
  static async course(userId: number, courseId: number) {
    const out = await this.call(userId, async ({ token, moodleUserId }) => {
      const r = await ws<{ usergrades: { gradeitems: {
        id: number; itemname: string | null; itemtype: string; gradeformatted?: string; percentageformatted?: string;
        feedback?: string; gradedatesubmitted?: number | null; gradedategraded?: number | null;
      }[] }[] }>(token, 'gradereport_user_get_grade_items', { courseid: courseId, userid: moodleUserId });
      const items = r.usergrades[0]?.gradeitems ?? [];
      return {
        total: cleanGrade(items.find((i) => i.itemtype === 'course')?.gradeformatted),
        items: items.filter((i) => i.itemtype !== 'course' && i.itemtype !== 'category').map((i) => ({
          id: i.id,
          name: i.itemname ?? '',
          grade: cleanGrade(i.gradeformatted),
          percent: cleanGrade(i.percentageformatted),
          feedback: cleanGrade(i.feedback),
          gradedAt: i.gradedategraded ? new Date(i.gradedategraded * 1000).toISOString() : null,
        })),
      };
    });
    if (!out) throw new AppError('Moodle відключено. Підключи ще раз.', 404);
    return out;
  }
}

/** Moodle username "ivan.petrenko.26@kse.org.ua" (or just "ivan.petrenko.26") vs the Google email in KSE Hub */
export function sameKsePerson(moodleUsername: string, email: string) {
  const u = moodleUsername.trim().toLowerCase();
  const e = email.trim().toLowerCase();
  return u === e || u === e.split('@')[0];
}
