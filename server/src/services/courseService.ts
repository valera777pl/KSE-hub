import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { courseCalendars, courseLinks, googleAccounts, userCalendars, users } from '../db/schema.js';
import { AppError } from '../middleware/errorHandler.js';
import { courseCodeIn } from '../utils/moodleGroups.js';
import { FriendService } from './friendService.js';
import { GmailService } from './gmailService.js';
import { MoodleService } from './moodleService.js';
import { ScheduleService, studentCard } from './scheduleService.js';

const DAY = 86_400_000;
const CODE = /^[A-Z]{2,6}\d{3}[A-Z]?$/;

export function slackUrl(link: { slackTeam: string | null; slackChannelId: string | null } | undefined): string | null {
  return link?.slackTeam && link.slackChannelId ? `https://${link.slackTeam}.slack.com/archives/${link.slackChannelId}` : null;
}

/**
 * Everything about one course in one place (NEXT-PROMPT.md §9): my sections, the next class,
 * my group's deadlines with their status, the Slack channel, friends on the course.
 */
export class CourseService {
  static async page(userId: number, code: string, now = new Date()) {
    if (!CODE.test(code)) throw new AppError('Невідомий курс', 400);

    const mine = await db.select({ id: courseCalendars.id, section: courseCalendars.section, title: courseCalendars.title })
      .from(userCalendars).innerJoin(courseCalendars, eq(courseCalendars.id, userCalendars.calendarId))
      .where(and(eq(userCalendars.userId, userId), eq(courseCalendars.courseCode, code)));

    const nextClass = (await ScheduleService.events(userId, now, new Date(now.getTime() + 21 * DAY)))
      .filter((e) => e.courseCode === code && e.endAt > now)
      .sort((a, b) => a.startAt.getTime() - b.startAt.getTime())[0] ?? null;

    const deadlines = (await MoodleService.getDeadlines(userId, true))
      .filter(({ assignment: a, courseName }) => courseCodeIn(courseName) === code && a.dueDate
        && a.dueDate.getTime() > now.getTime() - 7 * DAY);
    if (!mine.length && !deadlines.length) throw new AppError('Цього курсу немає в твоєму розкладі', 404);

    const [link] = await db.select().from(courseLinks).where(eq(courseLinks.courseCode, code)).limit(1);

    // Mutual friends on this course; "same section" when they sit in one of my calendars
    const friendIds = await FriendService.friendIds(userId);
    const onCourse = friendIds.length
      ? await db.select({ userId: users.id, avatarUrl: users.avatarUrl, email: googleAccounts.email, calendarId: courseCalendars.id, section: courseCalendars.section })
          .from(userCalendars)
          .innerJoin(courseCalendars, eq(courseCalendars.id, userCalendars.calendarId))
          .innerJoin(users, eq(users.id, userCalendars.userId))
          .innerJoin(googleAccounts, eq(googleAccounts.userId, users.id))
          .where(and(eq(courseCalendars.courseCode, code), inArray(userCalendars.userId, friendIds), eq(users.scheduleVisible, true)))
      : [];
    const myCalendars = new Set(mine.map((c) => c.id));
    const friends = [...new Map(onCourse.map((f) => [f.userId, f])).values()].map((f) => ({
      ...studentCard({ email: f.email, avatarUrl: f.avatarUrl }),
      userId: f.userId,
      sameSection: onCourse.some((x) => x.userId === f.userId && myCalendars.has(x.calendarId)),
    })).sort((a, b) => Number(b.sameSection) - Number(a.sameSection));

    return {
      code,
      title: mine[0]?.title ?? deadlines[0]?.courseName?.replace(code, '').trim() ?? null,
      sections: [...new Set(mine.map((c) => c.section).filter(Boolean))].sort(),
      nextClass,
      deadlines,
      slack: slackUrl(link) ? { url: slackUrl(link)!, name: link!.slackChannelName } : null,
      officeHours: link?.officeHours ?? null,
      friends,
    };
  }

  /** «Листи про курс»: the newest emails with the code in the subject, straight from Gmail, nothing kept. */
  static async mail(userId: number, code: string) {
    if (!CODE.test(code)) throw new AppError('Невідомий курс', 400);
    return GmailService.searchLive(userId, `subject:${code} newer_than:60d`, 5);
  }
}
