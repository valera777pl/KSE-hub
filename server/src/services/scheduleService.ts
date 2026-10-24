import { db } from '../db/connection.js';
import { calendarEvents, classReminders, courseCalendars, googleAccounts, userCalendars, users } from '../db/schema.js';
import { and, asc, eq, gt, gte, inArray, isNotNull, isNull, lt, lte, ne, notInArray, or, sql } from 'drizzle-orm';
import { GoogleService } from './googleService.js';
import { AppError } from '../middleware/errorHandler.js';
import { toLatin } from '../utils/translit.js';
import { formatKyiv, kyivWeekStart } from '../utils/kyivTime.js';
import { diffSchedule, type ScheduleChange } from '../utils/scheduleDiff.js';
import { escapeHtml, openAppKeyboard, sendToUser } from '../bot/send.js';
import { AnalyticsService } from './analyticsService.js';

type Account = typeof googleAccounts.$inferSelect;
type CourseCalendar = typeof courseCalendars.$inferSelect;

const DAY = 86_400_000;
const SUBSCRIPTIONS_SYNC_EVERY = 12 * 3_600_000;
// Not synced on schedule.kse.ua yet: look again every hour so the schedule shows up soon after they do
const EMPTY_SUBSCRIPTIONS_SYNC_EVERY = 3_600_000;
const EVENTS_SYNC_EVERY = 2 * 3_600_000;
// Changes further out than two weeks aren't worth a message yet
const CHANGE_HORIZON = 14 * DAY;
const EVENT_SYNC_CONCURRENCY = 5;
// "ECON100 [L1] Principles of Economics – Fall 26/27" → code, section, name
const COURSE_CALENDAR = /^([A-Z]{2,6}\d{3}[A-Z]?)\s*\[([^\]]+)\]\s*(.+?)(?:\s+[–-]\s+(?:Fall|Spring|Summer)\b.*)?$/;

export type ScheduleEvent = {
  id: number;
  calendarId: number;
  courseCode: string;
  section: string | null;
  title: string;
  location: string | null;
  startAt: Date;
  endAt: Date;
};

export class ScheduleService {
  /**
   * Re-read which course calendars the student is subscribed to, then refresh
   * the events of any of those calendars that are out of date.
   */
  static async syncAccount(account: Account) {
    const token = await GoogleService.accessToken(account);
    const list = await calendarApi<{ items?: { id: string; summary?: string; accessRole?: string }[] }>(
      token, 'users/me/calendarList?maxResults=250'
    );

    const subscribed: CourseCalendar[] = [];
    for (const item of list.items ?? []) {
      // Only KSE course-section calendars; the primary and personal ones stay private
      const match = item.summary?.match(COURSE_CALENDAR);
      if (!match || !item.id.endsWith('@group.calendar.google.com')) continue;
      const values = { googleId: item.id, courseCode: match[1], section: match[2], title: match[3].trim() };
      const [row] = await db.insert(courseCalendars).values(values)
        .onConflictDoUpdate({ target: courseCalendars.googleId, set: values }).returning();
      subscribed.push(row);
    }

    const ids = subscribed.map((c) => c.id);
    await db.delete(userCalendars).where(and(
      eq(userCalendars.userId, account.userId),
      ids.length ? notInArray(userCalendars.calendarId, ids) : sql`true`
    ));
    if (ids.length) {
      await db.insert(userCalendars).values(ids.map((calendarId) => ({ userId: account.userId, calendarId }))).onConflictDoNothing();
    }
    await db.update(googleAccounts).set({ calendarsSyncedAt: new Date() }).where(eq(googleAccounts.id, account.id));

    const staleBefore = Date.now() - EVENTS_SYNC_EVERY;
    const stale = subscribed.filter((c) => !c.eventsSyncedAt || c.eventsSyncedAt.getTime() < staleBefore);
    for (let i = 0; i < stale.length; i += EVENT_SYNC_CONCURRENCY) {
      await Promise.all(stale.slice(i, i + EVENT_SYNC_CONCURRENCY).map((c) => this.syncEvents(c, token)));
    }
    return subscribed.length;
  }

  /** Replace a calendar's events from last week to five weeks ahead. */
  static async syncEvents(calendar: CourseCalendar, token: string) {
    const from = new Date(kyivWeekStart().getTime() - 7 * DAY);
    const to = new Date(from.getTime() + 6 * 7 * DAY);

    const items: GoogleEvent[] = [];
    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({
        timeMin: from.toISOString(), timeMax: to.toISOString(),
        singleEvents: 'true', orderBy: 'startTime', maxResults: '250',
        ...(pageToken ? { pageToken } : {}),
      });
      const page = await calendarApi<{ items?: GoogleEvent[]; nextPageToken?: string }>(
        token, `calendars/${encodeURIComponent(calendar.googleId)}/events?${params}`
      );
      items.push(...(page.items ?? []));
      pageToken = page.nextPageToken;
    } while (pageToken);

    const rows = items
      .filter((e) => e.status !== 'cancelled' && e.start?.dateTime && e.end?.dateTime)
      .map((e) => ({
        calendarId: calendar.id,
        googleEventId: e.id,
        title: e.summary || calendar.title,
        location: e.location || null,
        startAt: new Date(e.start!.dateTime!),
        endAt: new Date(e.end!.dateTime!),
      }));

    // Snapshot before replacing, to tell subscribers what moved (not on the very first sync)
    const previous = calendar.eventsSyncedAt
      ? await db.select().from(calendarEvents).where(and(
          eq(calendarEvents.calendarId, calendar.id),
          gte(calendarEvents.startAt, from),
          lt(calendarEvents.startAt, to)
        ))
      : [];

    await db.transaction(async (tx) => {
      await tx.delete(calendarEvents).where(and(
        eq(calendarEvents.calendarId, calendar.id),
        gte(calendarEvents.startAt, from),
        lt(calendarEvents.startAt, to)
      ));
      if (rows.length) await tx.insert(calendarEvents).values(rows).onConflictDoNothing();
      await tx.update(courseCalendars).set({ eventsSyncedAt: new Date() }).where(eq(courseCalendars.id, calendar.id));
    });

    if (calendar.eventsSyncedAt) {
      const changes = diffSchedule(previous, rows, new Date(), CHANGE_HORIZON);
      if (changes.length) await this.notifyChanges(calendar, changes);
    }
  }

  /** One message per student for all changes in this course section. */
  private static async notifyChanges(calendar: CourseCalendar, changes: ScheduleChange[]) {
    const subscribers = await db
      .select({ id: users.id, telegramId: users.telegramId })
      .from(userCalendars)
      .innerJoin(users, eq(users.id, userCalendars.userId))
      .where(and(
        eq(userCalendars.calendarId, calendar.id),
        eq(users.notifyScheduleChanges, true),
        eq(users.botBlocked, false),
        isNotNull(users.onboardedAt)
      ));
    if (!subscribers.length) return;

    const course = `<b>${escapeHtml(calendar.courseCode)} [${escapeHtml(calendar.section ?? '')}]</b>`;
    const lines = changes.slice(0, 8).map((c) => {
      switch (c.kind) {
        case 'moved':
          return `🔄 ${formatKyiv(c.before.startAt)} → <b>${formatKyiv(c.after.startAt)}</b>${c.after.location ? ` · ${escapeHtml(c.after.location)}` : ''}`;
        case 'room':
          return `🚪 ${formatKyiv(c.after.startAt)}: тепер <b>${escapeHtml(c.after.location ?? 'без аудиторії')}</b>`;
        case 'cancelled':
          return `❌ ${formatKyiv(c.before.startAt)} — скасовано`;
        case 'added':
          return `➕ ${formatKyiv(c.after.startAt)}${c.after.location ? ` · ${escapeHtml(c.after.location)}` : ''}`;
      }
    });
    const more = changes.length > 8 ? `\n…і ще ${changes.length - 8}` : '';
    const text = `📅 Зміни в розкладі ${course}\n\n${lines.join('\n')}${more}`;

    for (const s of subscribers) {
      if (await sendToUser(s.telegramId, text, openAppKeyboard('Відкрити розклад'))) {
        AnalyticsService.track(s.id, 'schedule.change_sent', { changes: changes.length });
      }
    }
  }

  /**
   * Cron: re-read course calendars whose events are older than 2 h, using any
   * subscriber's token. Keeps change notifications timely.
   */
  static async syncStaleCalendars(limit = 8) {
    const staleBefore = new Date(Date.now() - EVENTS_SYNC_EVERY);
    const due = await db
      .selectDistinctOn([courseCalendars.id], { calendar: courseCalendars, account: googleAccounts })
      .from(courseCalendars)
      .innerJoin(userCalendars, eq(userCalendars.calendarId, courseCalendars.id))
      .innerJoin(googleAccounts, eq(googleAccounts.userId, userCalendars.userId))
      .where(and(
        or(isNull(courseCalendars.eventsSyncedAt), lt(courseCalendars.eventsSyncedAt, staleBefore)),
        or(isNull(googleAccounts.syncError), ne(googleAccounts.syncError, 'invalid_grant'))
      ))
      .orderBy(courseCalendars.id)
      .limit(limit);

    const tokens = new Map<number, string>();
    let synced = 0;
    for (const { calendar, account } of due) {
      try {
        if (!tokens.has(account.id)) tokens.set(account.id, await GoogleService.accessToken(account));
        await this.syncEvents(calendar, tokens.get(account.id)!);
        synced++;
      } catch (err) {
        console.error(`Events sync failed for ${calendar.courseCode} [${calendar.section}]:`, err);
      }
    }
    return synced;
  }

  /** Cron: "class in ~15 min" for students who turned it on; once per class. */
  static async sendClassReminders() {
    const now = Date.now();
    const rows = await db
      .select({
        userId: users.id, telegramId: users.telegramId,
        calendarId: calendarEvents.calendarId, googleEventId: calendarEvents.googleEventId,
        courseCode: courseCalendars.courseCode, section: courseCalendars.section,
        location: calendarEvents.location, startAt: calendarEvents.startAt,
      })
      .from(calendarEvents)
      .innerJoin(courseCalendars, eq(courseCalendars.id, calendarEvents.calendarId))
      .innerJoin(userCalendars, eq(userCalendars.calendarId, calendarEvents.calendarId))
      .innerJoin(users, eq(users.id, userCalendars.userId))
      .where(and(
        eq(users.classReminders, true),
        eq(users.botBlocked, false),
        // The cron runs every ~10 min, so the window is 5–25 min ahead
        gt(calendarEvents.startAt, new Date(now + 5 * 60_000)),
        lte(calendarEvents.startAt, new Date(now + 25 * 60_000))
      ));

    let sent = 0;
    for (const r of rows) {
      const claimed = await db.insert(classReminders)
        .values({ userId: r.userId, eventId: `${r.calendarId}:${r.googleEventId}` })
        .onConflictDoNothing().returning();
      if (!claimed.length) continue;
      const minutes = Math.round((r.startAt.getTime() - now) / 60_000);
      const where = r.location ? `\n📍 ${escapeHtml(r.location)}` : '';
      if (await sendToUser(r.telegramId, `⏰ Через ${minutes} хв: <b>${escapeHtml(r.courseCode)} [${escapeHtml(r.section ?? '')}]</b>${where}`)) {
        sent++;
        AnalyticsService.track(r.userId, 'class_reminder.sent');
      }
    }
    return sent;
  }

  /** Cron: refresh subscriptions older than 12 h (1 h for students with no course calendars yet). */
  static async syncDueAccounts(limit = 5) {
    const staleBefore = new Date(Date.now() - SUBSCRIPTIONS_SYNC_EVERY);
    const emptyStaleBefore = new Date(Date.now() - EMPTY_SUBSCRIPTIONS_SYNC_EVERY);
    const hasNoCalendars = sql`not exists (select 1 from ${userCalendars} where ${userCalendars.userId} = ${googleAccounts.userId})`;
    const due = await db.select().from(googleAccounts)
      .where(and(
        or(isNull(googleAccounts.syncError), ne(googleAccounts.syncError, 'invalid_grant')),
        or(
          isNull(googleAccounts.calendarsSyncedAt),
          lt(googleAccounts.calendarsSyncedAt, staleBefore),
          and(hasNoCalendars, lt(googleAccounts.calendarsSyncedAt, emptyStaleBefore))
        )
      ))
      .orderBy(sql`${googleAccounts.calendarsSyncedAt} asc nulls first`)
      .limit(limit);

    let synced = 0;
    for (const account of due) {
      try {
        await this.syncAccount(account);
        synced++;
      } catch (err) {
        console.error(`Schedule sync failed for ${account.email}:`, err);
      }
    }
    return synced;
  }

  /** The student's classes in [from, to). */
  static async events(userId: number, from: Date, to: Date): Promise<ScheduleEvent[]> {
    return db
      .select({
        id: calendarEvents.id,
        calendarId: calendarEvents.calendarId,
        courseCode: courseCalendars.courseCode,
        section: courseCalendars.section,
        title: calendarEvents.title,
        location: calendarEvents.location,
        startAt: calendarEvents.startAt,
        endAt: calendarEvents.endAt,
      })
      .from(userCalendars)
      .innerJoin(courseCalendars, eq(userCalendars.calendarId, courseCalendars.id))
      .innerJoin(calendarEvents, eq(calendarEvents.calendarId, courseCalendars.id))
      .where(and(eq(userCalendars.userId, userId), gte(calendarEvents.startAt, from), lt(calendarEvents.startAt, to)))
      .orderBy(asc(calendarEvents.startAt));
  }

  static weekEvents(userId: number, week: string | Date = new Date()) {
    const start = kyivWeekStart(week);
    return this.events(userId, start, new Date(start.getTime() + 7 * DAY));
  }

  static async calendarIds(userId: number): Promise<Set<number>> {
    const rows = await db.select({ id: userCalendars.calendarId }).from(userCalendars).where(eq(userCalendars.userId, userId));
    return new Set(rows.map((r) => r.id));
  }

  /** Students with a connected KSE account and a visible schedule, by surname or name (Cyrillic or Latin). */
  static async searchStudents(query: string, selfId: number, limit = 10) {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    const latin = toLatin(q).replace(/\s+/g, '%');
    const rows = await db
      .select({ userId: users.id, fullName: users.fullName, username: users.username, email: googleAccounts.email })
      .from(users)
      .innerJoin(googleAccounts, eq(googleAccounts.userId, users.id))
      .where(and(
        eq(users.scheduleVisible, true),
        ne(users.id, selfId),
        or(
          sql`split_part(${googleAccounts.email}, '@', 1) ilike ${`%${latin}%`}`,
          sql`${users.fullName} ilike ${`%${q}%`}`
        )
      ))
      .limit(limit);
    return rows.map(({ email, ...r }) => ({ ...r, ...nameFromEmail(email) }));
  }

  /** Another student's week, each class marked `shared` when it's in a calendar both attend. */
  static async compare(selfId: number, otherId: number, week: string | Date = new Date()) {
    const [other] = await db
      .select({ userId: users.id, fullName: users.fullName, username: users.username, visible: users.scheduleVisible, email: googleAccounts.email })
      .from(users)
      .innerJoin(googleAccounts, eq(googleAccounts.userId, users.id))
      .where(eq(users.id, otherId))
      .limit(1);
    if (!other || !other.visible) throw new AppError('Цей студент приховав свій розклад', 404);

    const mine = await this.calendarIds(selfId);
    const events = await this.weekEvents(otherId, week);
    const { email, visible, ...student } = other;
    return {
      student: { ...student, ...nameFromEmail(email) },
      weekStart: kyivWeekStart(week),
      events: events.map((e) => ({ ...e, shared: mine.has(e.calendarId) })),
      sharedCourses: [...new Set(events.filter((e) => mine.has(e.calendarId)).map((e) => `${e.courseCode} [${e.section}]`))],
    };
  }

  /** Classmates (share at least one section) with no class overlapping [start, end). */
  static async freeClassmates(selfId: number, start: Date, end: Date) {
    const mine = [...await this.calendarIds(selfId)];
    if (!mine.length) return [];

    const classmates = await db
      .selectDistinct({ userId: users.id, fullName: users.fullName, username: users.username, email: googleAccounts.email })
      .from(userCalendars)
      .innerJoin(users, eq(users.id, userCalendars.userId))
      .innerJoin(googleAccounts, eq(googleAccounts.userId, users.id))
      .where(and(inArray(userCalendars.calendarId, mine), ne(users.id, selfId), eq(users.scheduleVisible, true)));
    if (!classmates.length) return [];

    const busy = await db
      .selectDistinct({ userId: userCalendars.userId })
      .from(userCalendars)
      .innerJoin(calendarEvents, eq(calendarEvents.calendarId, userCalendars.calendarId))
      .where(and(
        inArray(userCalendars.userId, classmates.map((c) => c.userId)),
        lt(calendarEvents.startAt, end),
        gt(calendarEvents.endAt, start)
      ));
    const busyIds = new Set(busy.map((b) => b.userId));
    return classmates.filter((c) => !busyIds.has(c.userId)).map(({ email, ...c }) => ({ ...c, ...nameFromEmail(email) }));
  }
}

type GoogleEvent = {
  id: string;
  status?: string;
  summary?: string;
  location?: string;
  start?: { dateTime?: string; date?: string };
  end?: { dateTime?: string; date?: string };
};

async function calendarApi<T>(token: string, path: string): Promise<T> {
  const res = await fetch(`https://www.googleapis.com/calendar/v3/${path}`, { headers: { Authorization: `Bearer ${token}` } });
  if (!res.ok) throw new Error(`Calendar API ${res.status}: ${(await res.text()).slice(0, 200)}`);
  return res.json() as Promise<T>;
}

/** "ivan.petrenko.26@kse.org.ua" → { name: "Ivan Petrenko", cohort: 2026 } */
export function nameFromEmail(email: string): { name: string; cohort: number | null } {
  const [local] = email.split('@');
  const parts = local.split('.');
  const year = /^\d{2}$/.test(parts[parts.length - 1]) ? 2000 + parseInt(parts.pop()!, 10) : null;
  const name = parts.map((p) => p.split('-').map((w) => w.charAt(0).toUpperCase() + w.slice(1)).join('-')).join(' ');
  return { name, cohort: year };
}
