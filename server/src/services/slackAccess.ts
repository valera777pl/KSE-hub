import { and, eq, inArray } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { courseCalendars, emails, googleAccounts, slackChannels, userCalendars, userSlackChannels, users } from '../db/schema.js';
import { channelNamesIn } from '../utils/slackLinks.js';
import { nameFromEmail } from './scheduleService.js';

type Channel = typeof slackChannels.$inferSelect;

/** What the server knows about a student that decides which private channels they see. */
export type StudentFacts = {
  sections: { courseCode: string; section: string | null }[];
  program: string | null;
  entryYear: number | null;
  mailChannelIds: Set<string>;
  mailChannelNames: Set<string>;
};

/** "Р8" (Cyrillic), "p 8", "P08" → "P8" */
const normSection = (s: string | null) => s?.replace(/\s+/g, '').replace(/^Р/i, 'P').toUpperCase().replace(/^([A-Z])0+(\d)/, '$1$2') ?? null;

/**
 * The one privacy rule (SLACK-DIGEST-PROMPT.md §4). Pending and hidden channels: nobody. Open: everyone.
 * Private: a student of its section (any section when the channel is for the whole course), of its cohort,
 * or anyone who got Slack notification emails from it.
 */
export function channelVisible(
  ch: Pick<Channel, 'channelId' | 'name' | 'isPrivate' | 'status' | 'courseCode' | 'section' | 'program' | 'cohortYear'>,
  s: StudentFacts,
): boolean {
  if (ch.status !== 'active') return false;
  if (!ch.isPrivate) return true;
  if (s.mailChannelIds.has(ch.channelId) || s.mailChannelNames.has(ch.name.toLowerCase())) return true;
  if (ch.courseCode) {
    return s.sections.some((x) => x.courseCode === ch.courseCode && (!ch.section || normSection(x.section) === normSection(ch.section)));
  }
  if (ch.cohortYear) return s.entryYear === ch.cohortYear && (!ch.program || s.program === ch.program);
  return false;
}

export class SlackAccess {
  static async facts(userId: number): Promise<StudentFacts> {
    const [sections, [user], [account], mailIds, slackMail] = await Promise.all([
      db.selectDistinct({ courseCode: courseCalendars.courseCode, section: courseCalendars.section })
        .from(userCalendars).innerJoin(courseCalendars, eq(userCalendars.calendarId, courseCalendars.id))
        .where(eq(userCalendars.userId, userId)),
      db.select({ faculty: users.faculty }).from(users).where(eq(users.id, userId)).limit(1),
      db.select({ email: googleAccounts.email }).from(googleAccounts).where(eq(googleAccounts.userId, userId)).limit(1),
      db.select({ channelId: userSlackChannels.channelId }).from(userSlackChannels).where(eq(userSlackChannels.userId, userId)),
      db.select({ subject: emails.subject }).from(emails).where(and(eq(emails.userId, userId), eq(emails.source, 'slack'))),
    ]);
    return {
      sections,
      program: user?.faculty?.trim().toUpperCase() || null,
      entryYear: account ? nameFromEmail(account.email).cohort : null,
      mailChannelIds: new Set(mailIds.map((r) => r.channelId)),
      mailChannelNames: new Set(slackMail.flatMap((r) => channelNamesIn(r.subject ?? ''))),
    };
  }

  /** Every channel this student may see; the feed, the digest, events and Copilot all go through here. */
  static async visibleChannels(userId: number): Promise<Channel[]> {
    const [facts, channels] = await Promise.all([
      this.facts(userId),
      db.select().from(slackChannels).where(eq(slackChannels.status, 'active')),
    ]);
    return channels.filter((ch) => channelVisible(ch, facts));
  }

  static async canSee(userId: number, channelId: string): Promise<boolean> {
    const [ch] = await db.select().from(slackChannels).where(eq(slackChannels.channelId, channelId)).limit(1);
    return !!ch && channelVisible(ch, await this.facts(userId));
  }

  /** Visible channel ids among these (for filtering a list of events or summaries at once). */
  static async visibleIds(userId: number, channelIds: string[]): Promise<Set<string>> {
    if (!channelIds.length) return new Set();
    const [facts, channels] = await Promise.all([
      this.facts(userId),
      db.select().from(slackChannels).where(inArray(slackChannels.channelId, channelIds)),
    ]);
    return new Set(channels.filter((ch) => channelVisible(ch, facts)).map((ch) => ch.channelId));
  }
}
