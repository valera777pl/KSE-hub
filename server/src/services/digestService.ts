import { db } from '../db/connection.js';
import { emails, moodleAssignments, moodleCourses, summaries, users, type DigestSource, type EmailSource } from '../db/schema.js';
import { and, asc, desc, eq, gt, inArray, isNull, lte, ne } from 'drizzle-orm';
import { digestText, isGeneralCourse, kyivDay, type Lang } from '../bot/messages.js';
import { kyivDayStart, kyivHour } from '../utils/kyivTime.js';
import { ScheduleService } from './scheduleService.js';
import { MoodleService } from './moodleService.js';
import { isOtherGroup } from '../utils/moodleGroups.js';
import { EventService } from './eventService.js';
import { SlackService } from './slackService.js';
import { channelNamesIn } from '../utils/slackLinks.js';

type User = typeof users.$inferSelect;

const EMAILS_PER_SECTION = 6;
const EMAIL_LOOKBACK_MS = 3 * 24 * 3_600_000;
const DEADLINE_DAYS = 3;
const HOUR = 3_600_000;
/** From this Kyiv hour the digest looks at tomorrow's classes */
const EVENING = 18;

/**
 * Builds the daily digest (PRODUCT.md template): the day, its classes, deadlines for 3 days,
 * important mail. Only sources the student picked; nothing that already happened.
 */
export class DigestService {
  /**
   * @param markDigested the scheduled digest marks the included emails so they
   *   don't repeat tomorrow; a preview leaves them alone.
   * @returns the message and the screen its button opens, or null when there's nothing to say
   */
  static async build(user: User, { markDigested = false, now = new Date() } = {}): Promise<{ text: string; startapp: string } | null> {
    const lang: Lang = user.languagePref === 'en' ? 'en' : 'uk';
    // An evening digest is about tomorrow
    const day = kyivHour(now) >= EVENING ? new Date(now.getTime() + 24 * HOUR) : now;
    const dayStart = kyivDayStart(kyivDay(day));
    const classes = (await ScheduleService.events(user.id, dayStart, new Date(dayStart.getTime() + 24 * HOUR)))
      .filter((e) => e.startAt > now)
      .sort((a, b) => a.startAt.getTime() - b.startAt.getTime());

    const deadlines = user.digestSources.includes('moodle')
      ? (await this.upcomingDeadlines(user.id, now, new Date(now.getTime() + DEADLINE_DAYS * 24 * HOUR), 12))
          .filter((r) => !isGeneralCourse(r.courseName))
          .map((r) => ({ title: r.assignment.title, courseName: r.courseName, dueDate: r.assignment.dueDate! }))
      : [];

    const includedEmailIds: number[] = [];
    const mailFor = async (source: EmailSource) => {
      if (!user.digestSources.includes(source)) return [];
      const rows = await this.emailLines(user, source);
      includedEmailIds.push(...rows.map((r) => r.id));
      return rows;
    };
    // Moodle's own emails keep their section; reminders about other practice groups are dropped (still marked as digested)
    const moodleMail = await mailFor('moodle');
    const groups = moodleMail.length ? await MoodleService.groups(user.id) : new Map();
    const moodle = moodleMail.filter((m) => !isOtherGroup(`${m.subject ?? ''} ${m.summary}`, null, groups));
    const mail = await mailFor('gmail');
    // Slack notification emails stay — except from channels the student already gets through the reader account
    const covered = new Set((await SlackService.subscribedChannels(user.id).catch(() => [])).map((ch) => ch.name));
    const slack = (await mailFor('slack')).filter((m) => !channelNamesIn(m.subject ?? '').some((n) => covered.has(n)));

    // Events the student asked to be reminded about, on this day
    const dayEvents = (await EventService.remindedOn(user.id, dayStart, new Date(dayStart.getTime() + 24 * HOUR)))
      .filter((e) => e.startsAt > now);

    const text = digestText({ lang, now, day, classes, deadlines, events: dayEvents, moodle, mail, slack });
    if (markDigested && includedEmailIds.length) {
      await db.update(emails).set({ digestedAt: new Date() }).where(inArray(emails.id, includedEmailIds));
    }
    return text ? { text, startapp: `day_${kyivDay(day)}` } : null;
  }

  /** Not-yet-digested emails from this source, important first, newsletters left out. */
  private static async emailLines(user: User, source: EmailSource) {
    const rows = await db
      .select({ id: emails.id, subject: emails.subject, fromName: emails.fromName, summary: summaries.summary })
      .from(emails)
      .innerJoin(summaries, eq(emails.summaryId, summaries.id))
      .where(
        and(
          eq(emails.userId, user.id),
          eq(emails.source, source),
          isNull(emails.digestedAt),
          ne(summaries.category, 'newsletter'),
          gt(emails.receivedAt, new Date(Date.now() - EMAIL_LOOKBACK_MS))
        )
      )
      .orderBy(desc(summaries.important), desc(emails.receivedAt))
      .limit(EMAILS_PER_SECTION);

    return rows;
  }

  static upcomingDeadlines(userId: number, from: Date, to: Date, limit = 20) {
    return db
      .select({ assignment: moodleAssignments, courseName: moodleCourses.courseName })
      .from(moodleAssignments)
      .leftJoin(moodleCourses, eq(moodleAssignments.courseId, moodleCourses.id))
      .where(
        and(
          eq(moodleAssignments.userId, userId),
          eq(moodleAssignments.isCompleted, false),
          eq(moodleAssignments.hidden, false),
          gt(moodleAssignments.dueDate, from),
          lte(moodleAssignments.dueDate, to)
        )
      )
      .orderBy(asc(moodleAssignments.dueDate))
      .limit(limit);
  }
}
