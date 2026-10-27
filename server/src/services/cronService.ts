import { db } from '../db/connection.js';
import { deadlineReminders, googleAccounts, moodleAssignments, moodleCourses, opportunities, savedOpportunities, users } from '../db/schema.js';
import { and, asc, eq, gt, isNotNull, isNull, lt, lte, ne, or, sql } from 'drizzle-orm';
import { MoodleService } from './moodleService.js';
import { DigestService } from './digestService.js';
import { GmailService } from './gmailService.js';
import { AnalyticsService } from './analyticsService.js';
import { ScheduleService } from './scheduleService.js';
import { escapeHtml, sendToUser } from '../bot/send.js';
import { appButton, deadlineReminderText, isGeneralCourse, weeklyText, type Lang } from '../bot/messages.js';
import { formatKyiv, kyivHour, kyivWeekday } from '../utils/kyivTime.js';

const langOf = (u: { languagePref: string | null }): Lang => (u.languagePref === 'en' ? 'en' : 'uk');

const HOUR = 3_600_000;
const CALENDAR_SYNC_EVERY = 3 * HOUR;
const CALENDARS_PER_TICK = 10;
// Just under the cron interval, so every inbox is checked on every tick
const GMAIL_SYNC_EVERY = 8 * 60_000;
const GMAIL_ACCOUNTS_PER_TICK = 25;
const GMAIL_CONCURRENCY = 3;

/**
 * One cron "tick" (an external scheduler calls it every ~10 minutes).
 * Each step is bounded so a tick fits comfortably inside one function run.
 */
export class CronService {
  static async tick() {
    const calendars = await this.syncCalendars();
    const emails = await this.syncGmail();
    const google = !!process.env.GOOGLE_CLIENT_ID;
    const schedules = google ? await ScheduleService.syncDueAccounts() : 0;
    const courseCalendars = google ? await ScheduleService.syncStaleCalendars() : 0;
    const classReminders = await ScheduleService.sendClassReminders();
    const reminders = await this.sendDeadlineReminders();
    const digests = await this.sendDigests();
    const weekly = await this.sendWeeklyDeadlines();
    const savedOpps = await this.sendSavedOpportunityReminders();
    return { calendars, emails, schedules, courseCalendars, classReminders, reminders, digests, weekly, savedOpps };
  }

  /** Sunday from 19:00 Kyiv: next week's Moodle deadlines in one message (classes are in the schedule tab). */
  static async sendWeeklyDeadlines() {
    const now = new Date();
    if (kyivWeekday(now) !== 0 || kyivHour(now) < 19) return 0;

    const due = await db.select().from(users).where(and(
      isNotNull(users.onboardedAt),
      eq(users.botBlocked, false),
      or(isNull(users.lastWeeklyAt), lt(users.lastWeeklyAt, new Date(now.getTime() - 5 * 24 * HOUR)))
    ));

    let sent = 0;
    for (const user of due) {
      await db.update(users).set({ lastWeeklyAt: now }).where(eq(users.id, user.id));
      if (!user.digestSources.includes('moodle')) continue;
      const rows = (await DigestService.upcomingDeadlines(user.id, now, new Date(now.getTime() + 8 * 24 * HOUR), 25))
        .filter((r) => !isGeneralCourse(r.courseName));
      if (!rows.length) continue;
      const lang = langOf(user);
      const text = weeklyText(lang, rows.map((r) => ({ title: r.assignment.title, courseName: r.courseName, dueDate: r.assignment.dueDate! })));
      if (await sendToUser(user.telegramId, text, appButton(lang === 'en' ? 'Open deadlines' : 'Відкрити дедлайни', 'deadlines'))) {
        sent++;
        AnalyticsService.track(user.id, 'weekly.sent');
      }
    }
    return sent;
  }

  /** Pull new mail for the accounts synced longest ago. Revoked accounts wait for a reconnect. */
  static async syncGmail() {
    if (!process.env.GOOGLE_CLIENT_ID) return 0;
    const staleBefore = new Date(Date.now() - GMAIL_SYNC_EVERY);
    const due = await db
      .select()
      .from(googleAccounts)
      .where(
        and(
          or(isNull(googleAccounts.syncError), ne(googleAccounts.syncError, 'invalid_grant')),
          // a partially failed sync keeps its old lastSyncAt, so it's picked up again next tick
          or(isNull(googleAccounts.lastSyncAt), lt(googleAccounts.lastSyncAt, staleBefore))
        )
      )
      .orderBy(sql`${googleAccounts.lastSyncAt} asc nulls first`)
      .limit(GMAIL_ACCOUNTS_PER_TICK);

    let stored = 0;
    for (let i = 0; i < due.length; i += GMAIL_CONCURRENCY) {
      await Promise.all(due.slice(i, i + GMAIL_CONCURRENCY).map(async (account) => {
        try {
          stored += await GmailService.sync(account);
        } catch (err) {
          console.error(`Gmail sync failed for ${account.email}:`, err);
        }
      }));
    }
    return stored;
  }

  /** Re-sync the Moodle calendars that are the most out of date. */
  static async syncCalendars() {
    const staleBefore = new Date(Date.now() - CALENDAR_SYNC_EVERY);
    const due = await db
      .select({ id: users.id, calendarUrl: users.calendarUrl })
      .from(users)
      .where(
        and(
          isNotNull(users.calendarUrl),
          eq(users.botBlocked, false),
          or(isNull(users.calendarSyncedAt), lt(users.calendarSyncedAt, staleBefore))
        )
      )
      .orderBy(sql`${users.calendarSyncedAt} asc nulls first`)
      .limit(CALENDARS_PER_TICK);

    let synced = 0;
    for (const user of due) {
      try {
        await MoodleService.syncCalendar(user.id, user.calendarUrl);
        synced++;
      } catch (err) {
        console.error(`Calendar sync failed for user ${user.id}:`, err);
      }
      // Mark as attempted either way so a broken URL doesn't block the queue
      await db.update(users).set({ calendarSyncedAt: new Date() }).where(eq(users.id, user.id));
    }
    return synced;
  }

  /** "24h" reminders for deadlines 3–24 h away, "3h" reminders for those under 3 h. */
  static async sendDeadlineReminders() {
    const now = new Date();
    const rows = await db
      .select({
        assignment: moodleAssignments,
        courseName: moodleCourses.courseName,
        telegramId: users.telegramId,
        digestSources: users.digestSources,
        languagePref: users.languagePref,
      })
      .from(moodleAssignments)
      .innerJoin(users, eq(moodleAssignments.userId, users.id))
      .leftJoin(moodleCourses, eq(moodleAssignments.courseId, moodleCourses.id))
      .where(
        and(
          eq(moodleAssignments.isCompleted, false),
          eq(users.botBlocked, false),
          gt(moodleAssignments.dueDate, now),
          lte(moodleAssignments.dueDate, new Date(now.getTime() + 24 * HOUR))
        )
      )
      .orderBy(asc(moodleAssignments.dueDate));

    let sent = 0;
    for (const { assignment, courseName, telegramId, digestSources, languagePref } of rows) {
      // University-wide events stay in the app without pushes (PRODUCT.md)
      if (!digestSources.includes('moodle') || isGeneralCourse(courseName)) continue;

      const due = assignment.dueDate!;
      const kind = due.getTime() - now.getTime() <= 3 * HOUR ? '3h' : '24h';

      // The unique index makes this the "send once" lock
      const claimed = await db
        .insert(deadlineReminders)
        .values({ assignmentId: assignment.id, kind })
        .onConflictDoNothing()
        .returning();
      if (claimed.length === 0) continue;

      const lang = langOf({ languagePref });
      const text = deadlineReminderText(lang, kind, { title: assignment.title, courseName, dueDate: due });
      if (await sendToUser(telegramId, text, appButton(lang === 'en' ? 'Open deadline' : 'Відкрити дедлайн', `deadline_${assignment.id}`))) {
        sent++;
        AnalyticsService.track(assignment.userId, 'reminder.sent', { kind });
      }
    }
    return sent;
  }

  /** Saved opportunities whose application closes within 3 days: one reminder each, with a button straight to it. */
  static async sendSavedOpportunityReminders() {
    const now = new Date();
    const rows = await db
      .select({ userId: savedOpportunities.userId, opp: opportunities, telegramId: users.telegramId, languagePref: users.languagePref })
      .from(savedOpportunities)
      .innerJoin(opportunities, eq(savedOpportunities.opportunityId, opportunities.id))
      .innerJoin(users, eq(savedOpportunities.userId, users.id))
      .where(and(
        isNull(savedOpportunities.remindedAt),
        eq(users.botBlocked, false),
        gt(opportunities.deadline, now),
        lte(opportunities.deadline, new Date(now.getTime() + 72 * HOUR)),
      ));

    let sent = 0;
    for (const { userId, opp, telegramId, languagePref } of rows) {
      // Claim first so two overlapping ticks can't both send it
      const claimed = await db.update(savedOpportunities).set({ remindedAt: now })
        .where(and(eq(savedOpportunities.userId, userId), eq(savedOpportunities.opportunityId, opp.id), isNull(savedOpportunities.remindedAt)))
        .returning();
      if (claimed.length === 0) continue;
      const en = languagePref === 'en';
      const text = `<b>${en ? 'Applications close' : 'Подача закінчується'} ${formatKyiv(opp.deadline!)}</b>\n${escapeHtml(opp.title)} · ${escapeHtml(opp.company)}`;
      if (await sendToUser(telegramId, text, appButton(en ? 'Open' : 'Відкрити', `opp_${opp.id}`))) sent++;
    }
    return sent;
  }

  /** Daily digest for everyone whose chosen hour is now (Kyiv time). */
  static async sendDigests() {
    const hour = kyivHour();
    const notSentToday = new Date(Date.now() - 20 * HOUR);
    const due = await db
      .select()
      .from(users)
      .where(
        and(
          eq(users.digestHour, hour),
          eq(users.botBlocked, false),
          or(isNull(users.lastDigestAt), lt(users.lastDigestAt, notSentToday))
        )
      );

    let sent = 0;
    for (const user of due) {
      // Stamp first: a crash mid-send must not turn into a duplicate digest
      await db.update(users).set({ lastDigestAt: new Date() }).where(eq(users.id, user.id));
      const digest = await DigestService.build(user, { markDigested: true });
      if (!digest) {
        // Nothing new in the chosen sources: no message, but visible in the admin dashboard
        AnalyticsService.track(user.id, 'digest.empty');
      } else if (await sendToUser(user.telegramId, digest.text, appButton(user.languagePref === 'en' ? 'Open the day' : 'Відкрити день', digest.startapp))) {
        sent++;
        AnalyticsService.track(user.id, 'digest.sent');
      } else {
        AnalyticsService.track(user.id, 'digest.failed');
      }
    }
    return sent;
  }
}
