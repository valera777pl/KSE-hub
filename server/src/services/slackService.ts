import { and, desc, eq, inArray, isNotNull } from 'drizzle-orm';
import { db } from '../db/connection.js';
import {
  courseCalendars, events, slackChannels, slackSummaries, userSlackSubscriptions, users, type SlackSlot,
} from '../db/schema.js';
import { AppError } from '../middleware/errorHandler.js';
import { channelScope, type ChannelScope } from '../utils/slackLinks.js';
import { DEFAULT_ON, eventSourceKey, laterTs, type IngestChannel } from '../utils/slackIngest.js';
import { SlackAccess } from './slackAccess.js';

type Channel = typeof slackChannels.$inferSelect;

const scopeColumns = (scope: ChannelScope | null) => ({
  courseCode: scope?.kind === 'course' ? scope.courseCode : null,
  section: scope?.kind === 'course' ? scope.section : null,
  program: scope?.kind === 'cohort' ? scope.program : null,
  cohortYear: scope?.kind === 'cohort' ? scope.cohortYear : null,
});

/** On by default: a private channel of my course or cohort, an open one per `default_on`. */
const defaultOn = (ch: Pick<Channel, 'isPrivate' | 'defaultOn'>) => ch.isPrivate || ch.defaultOn;

export class SlackService {
  /** Where each channel's task left off. */
  static async cursors() {
    const rows = await db.select({ channelId: slackChannels.channelId, name: slackChannels.name, lastTs: slackChannels.lastTs })
      .from(slackChannels);
    return { channels: rows };
  }

  /**
   * Claude's task delivers. Idempotent: the same (channel, toTs) twice is one summary.
   * New channels: open ones go live at once, private ones once their name tells the course or cohort.
   */
  static async ingest(channels: IngestChannel[]) {
    const known = await this.knownCourses();
    let drafts = 0;
    let published = 0;
    for (const c of channels) {
      const ch = await this.upsertChannel(c, known);
      if (!c.summary) continue;
      const [row] = await db.insert(slackSummaries).values({
        channelId: c.channelId, fromTs: c.fromTs, toTs: c.toTs, summary: c.summary, items: c.items, events: c.events,
      }).onConflictDoNothing().returning({ id: slackSummaries.id });
      if (!row) continue;
      if (ch.autoPublish && ch.status === 'active') {
        await this.publish(row.id);
        published++;
      } else drafts++;
    }
    return { channels: channels.length, drafts, published };
  }

  private static async knownCourses() {
    const [courses, programs] = await Promise.all([
      db.selectDistinct({ courseCode: courseCalendars.courseCode, title: courseCalendars.title }).from(courseCalendars),
      db.selectDistinct({ faculty: users.faculty }).from(users).where(isNotNull(users.faculty)),
    ]);
    return { courses, programs: [...new Set(programs.map((p) => p.faculty!.trim().toUpperCase()).filter(Boolean))] };
  }

  private static async upsertChannel(c: IngestChannel, known: Awaited<ReturnType<typeof SlackService.knownCourses>>): Promise<Channel> {
    const [old] = await db.select().from(slackChannels).where(eq(slackChannels.channelId, c.channelId)).limit(1);
    const scope = c.isPrivate ? channelScope(c.channelName, known) : null;
    if (!old) {
      const [row] = await db.insert(slackChannels).values({
        channelId: c.channelId,
        name: c.channelName,
        team: c.team ?? null,
        isPrivate: c.isPrivate,
        status: !c.isPrivate || scope ? 'active' : 'pending',
        ...scopeColumns(scope),
        lastTs: c.toTs,
        defaultOn: !c.isPrivate && DEFAULT_ON.has(c.channelName),
      }).returning();
      return row;
    }
    // A pending channel can be recognised later (its course appeared in someone's schedule); the owner's choices stay
    const recognised = old.status === 'pending' && scope && !old.courseCode && !old.cohortYear;
    const [row] = await db.update(slackChannels).set({
      name: c.channelName,
      team: c.team ?? old.team,
      lastTs: laterTs(old.lastTs, c.toTs),
      ...(recognised ? { status: 'active' as const, ...scopeColumns(scope) } : {}),
    }).where(eq(slackChannels.channelId, c.channelId)).returning();
    return row;
  }

  /** A summary goes out: visible in the feed, its events land in «Події». */
  static async publish(id: number, edit?: { summary?: string }) {
    const [s] = await db.update(slackSummaries)
      .set({ status: 'published', publishedAt: new Date(), ...(edit?.summary ? { summary: edit.summary } : {}) })
      .where(eq(slackSummaries.id, id)).returning();
    if (!s) throw new AppError('Підсумок не знайдено', 404);
    const [ch] = await db.select().from(slackChannels).where(eq(slackChannels.channelId, s.channelId)).limit(1);
    for (const e of s.events) {
      await db.insert(events).values({
        title: e.title,
        startsAt: new Date(e.startsAt),
        location: e.place ?? null,
        registrationUrl: e.permalink,
        audience: ch?.isPrivate ? 'slack' : 'all',
        slackChannelId: ch?.isPrivate ? ch.channelId : null,
        sourceKey: eventSourceKey(s.channelId, e.permalink),
      }).onConflictDoNothing();
    }
    return s;
  }

  /** Published summaries from channels this student may see, newest first. */
  static async feed(userId: number, limit = 30) {
    const channels = await SlackAccess.visibleChannels(userId);
    if (!channels.length) return { summaries: [] };
    const byId = new Map(channels.map((ch) => [ch.channelId, ch]));
    const rows = await db.select().from(slackSummaries)
      .where(and(eq(slackSummaries.status, 'published'), inArray(slackSummaries.channelId, [...byId.keys()])))
      .orderBy(desc(slackSummaries.publishedAt)).limit(limit);
    return {
      summaries: rows.map((s) => {
        const ch = byId.get(s.channelId)!;
        return {
          id: s.id, channelId: s.channelId, channelName: ch.name, isPrivate: ch.isPrivate, courseCode: ch.courseCode,
          url: ch.team ? `https://${ch.team}.slack.com/archives/${ch.channelId}` : null,
          summary: s.summary, items: s.items, publishedAt: s.publishedAt,
        };
      }),
    };
  }

  /** The student's channels with on/off, and when the Slack digest comes. */
  static async subscriptions(userId: number) {
    const [channels, subs, [user]] = await Promise.all([
      SlackAccess.visibleChannels(userId),
      db.select().from(userSlackSubscriptions).where(eq(userSlackSubscriptions.userId, userId)),
      db.select({ slots: users.slackDigestSlots }).from(users).where(eq(users.id, userId)).limit(1),
    ]);
    const mine = new Map(subs.map((s) => [s.channelId, s.on]));
    return {
      slots: user?.slots ?? ['evening'],
      channels: channels
        .map((ch) => ({
          channelId: ch.channelId, name: ch.name, isPrivate: ch.isPrivate,
          courseCode: ch.courseCode, section: ch.section, program: ch.program, cohortYear: ch.cohortYear,
          on: mine.get(ch.channelId) ?? defaultOn(ch),
        }))
        .sort((a, b) => Number(b.isPrivate) - Number(a.isPrivate) || a.name.localeCompare(b.name)),
    };
  }

  static async updateSubscriptions(userId: number, body: { slots?: SlackSlot[]; channels?: { channelId: string; on: boolean }[] }) {
    if (body.slots) await db.update(users).set({ slackDigestSlots: body.slots, updatedAt: new Date() }).where(eq(users.id, userId));
    if (body.channels?.length) {
      const visible = await SlackAccess.visibleIds(userId, body.channels.map((c) => c.channelId));
      if (body.channels.some((c) => !visible.has(c.channelId))) throw new AppError('Немає доступу до каналу', 403);
      for (const c of body.channels) {
        await db.insert(userSlackSubscriptions).values({ userId, ...c })
          .onConflictDoUpdate({ target: [userSlackSubscriptions.userId, userSlackSubscriptions.channelId], set: { on: c.on } });
      }
    }
    return this.subscriptions(userId);
  }

  /** Channels this student reads in the digest: visible and switched on. */
  static async subscribedChannels(userId: number): Promise<Channel[]> {
    const [channels, subs] = await Promise.all([
      SlackAccess.visibleChannels(userId),
      db.select().from(userSlackSubscriptions).where(eq(userSlackSubscriptions.userId, userId)),
    ]);
    const mine = new Map(subs.map((s) => [s.channelId, s.on]));
    return channels.filter((ch) => mine.get(ch.channelId) ?? defaultOn(ch));
  }
}
