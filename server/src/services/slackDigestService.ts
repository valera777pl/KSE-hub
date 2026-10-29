import { and, desc, eq, gt, inArray, isNotNull, isNull, max, sql } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { slackDeliveries, slackSummaries, users, type SlackSlot } from '../db/schema.js';
import { appButton, slackDigestText, type Lang, type SlackDigestChannel } from '../bot/messages.js';
import { kyivHour } from '../utils/kyivTime.js';
import { AnalyticsService } from './analyticsService.js';
import { PushService } from './pushService.js';
import { SlackService } from './slackService.js';

type User = typeof users.$inferSelect;

/** The student's choice: morning 09:00, evening 20:00 or both (SLACK-DIGEST-PROMPT.md §6) */
export const SLOT_HOUR: Record<SlackSlot, number> = { morning: 9, evening: 20 };
/** Only summaries this fresh go out: a new subscriber doesn't get a week of backlog */
const LOOKBACK_MS = 3 * 24 * 3_600_000;
/** The owner publishes drafts one by one: wait for a quiet spell so they go out as one message */
export const QUIET_MS = 10 * 60_000;
/** …but not for long, and never at night */
const REVIEW_WINDOW_MS = 40 * 60_000;
const DAY_FROM = 8;
const DAY_TO = 22;

/**
 * Whether this tick sends a student their Slack digest: at their slot hour, or soon after the owner
 * published drafts by hand (`lastPublishedAt` counts only those — automatic summaries wait for the slot).
 */
export function slackDigestDue(p: { hour: number; slots: SlackSlot[]; lastPublishedAt: Date | null; now: Date }): 'slot' | 'review' | null {
  if (p.slots.some((s) => SLOT_HOUR[s] === p.hour)) return 'slot';
  if (!p.lastPublishedAt || p.hour < DAY_FROM || p.hour >= DAY_TO) return null;
  const since = p.now.getTime() - p.lastPublishedAt.getTime();
  return since >= QUIET_MS && since <= REVIEW_WINDOW_MS ? 'review' : null;
}

export class SlackDigestService {
  /** One tick of the cron: everyone whose digest is due gets what they haven't seen yet. */
  static async tick(now = new Date()) {
    const hour = kyivHour(now);
    const [{ last, reviewed } = { last: null, reviewed: null }] = await db.select({
      last: max(slackSummaries.publishedAt),
      reviewed: sql<Date | null>`max(${slackSummaries.publishedAt}) filter (where ${slackSummaries.reviewed})`,
    }).from(slackSummaries).where(eq(slackSummaries.status, 'published'));
    // Nothing published lately: nothing to check per student
    if (!last || now.getTime() - new Date(last).getTime() > LOOKBACK_MS) return 0;
    // Only the owner's hand-published summaries go out between the slots; automatic ones wait for 09:00 / 20:00
    const lastPublishedAt = reviewed ? new Date(reviewed) : null;
    const isSlotHour = Object.values(SLOT_HOUR).includes(hour);
    if (!isSlotHour && !slackDigestDue({ hour, slots: [], lastPublishedAt, now })) return 0;

    // Test mode until the reader account has its honest name (PLAN.md → S1): only admins get it
    const forAll = process.env.SLACK_DIGEST_FOR_ALL === '1';
    const students = await db.select().from(users)
      .where(and(isNotNull(users.onboardedAt), eq(users.botBlocked, false), forAll ? undefined : eq(users.isAdmin, true)));
    let sent = 0;
    for (const user of students) {
      const due = slackDigestDue({ hour, slots: user.slackDigestSlots, lastPublishedAt, now });
      if (!due) continue;
      if (await this.sendTo(user, now).catch((err) => { console.error('Slack digest failed:', err); return false; })) sent++;
    }
    return sent;
  }

  /** Published, not yet delivered summaries from the student's switched-on channels, as one message. */
  static async sendTo(user: User, now = new Date()): Promise<boolean> {
    const channels = await SlackService.subscribedChannels(user.id);
    if (!channels.length) return false;
    const rows = await db.select({ s: slackSummaries }).from(slackSummaries)
      .leftJoin(slackDeliveries, and(eq(slackDeliveries.summaryId, slackSummaries.id), eq(slackDeliveries.userId, user.id)))
      .where(and(
        eq(slackSummaries.status, 'published'),
        inArray(slackSummaries.channelId, channels.map((c) => c.channelId)),
        gt(slackSummaries.publishedAt, new Date(now.getTime() - LOOKBACK_MS)),
        isNull(slackDeliveries.summaryId),
      ))
      .orderBy(desc(slackSummaries.publishedAt));
    if (!rows.length) return false;

    // Private course channels first, then open ones; several summaries of one channel merge, newest first
    const byChannel = new Map<string, SlackDigestChannel>();
    for (const ch of [...channels].sort((a, b) => Number(b.isPrivate) - Number(a.isPrivate) || a.name.localeCompare(b.name))) {
      const own = rows.filter((r) => r.s.channelId === ch.channelId);
      if (!own.length) continue;
      byChannel.set(ch.channelId, {
        name: ch.name, courseCode: ch.courseCode, section: ch.section,
        url: ch.team ? `https://${ch.team}.slack.com/archives/${ch.channelId}` : null,
        points: own.flatMap(({ s }) => (s.items.length
          ? s.items.map((i) => ({ text: i.text, permalink: i.permalink }))
          : s.summary.split('\n').filter(Boolean).map((text) => ({ text, permalink: '' })))),
      });
    }
    const lang: Lang = user.languagePref === 'en' ? 'en' : 'uk';
    const text = slackDigestText(lang, now, [...byChannel.values()].map((c) => ({ ...c, points: c.points.filter((p) => p.text) })));
    if (!text) return false;

    // Stamp first: a crash mid-send must not turn into the same digest twice
    await db.insert(slackDeliveries).values(rows.map(({ s }) => ({ userId: user.id, summaryId: s.id }))).onConflictDoNothing();
    const ok = await PushService.send(user, 'slack', text, appButton(lang === 'en' ? 'All summaries' : 'Усі підсумки', 'slack', 'slack'));
    AnalyticsService.track(user.id, ok ? 'slack.digest.sent' : 'slack.digest.failed', { channels: byChannel.size });
    return ok;
  }
}
