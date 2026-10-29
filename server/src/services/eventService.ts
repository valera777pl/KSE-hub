import { and, asc, eq, gt, inArray, isNull, lt, or } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { events, reminders, slackChannels, users } from '../db/schema.js';
import { AppError } from '../middleware/errorHandler.js';
import { eventReminderText, eventRemindAt } from '../utils/events.js';
import { ReminderService } from './reminderService.js';
import { SlackAccess } from './slackAccess.js';

/** Mass mailings, my own invites, and events from private Slack channels I may see (slackAccess.ts). */
async function visibleTo(userId: number) {
  const channels = (await SlackAccess.visibleChannels(userId)).filter((ch) => ch.isPrivate).map((ch) => ch.channelId);
  return or(
    eq(events.audience, 'all'),
    eq(events.userId, userId),
    channels.length ? and(eq(events.audience, 'slack'), inArray(events.slackChannelId, channels)) : undefined,
  );
}

/** "slack:C06KXECQQFQ:p1793…" → "C06KXECQQFQ": events posted in a Slack channel carry it in their key */
export const slackChannelOf = (sourceKey: string) => sourceKey.match(/^slack:([CG][A-Z0-9]+):/)?.[1] ?? null;

/** "#event" for events from Slack, so the app can say where it came from (SLACK-DIGEST-PROMPT.md §7.4) */
async function slackNames(keys: string[]) {
  const ids = [...new Set(keys.map(slackChannelOf).filter((id): id is string => !!id))];
  if (!ids.length) return new Map<string, string>();
  const rows = await db.select({ id: slackChannels.channelId, name: slackChannels.name }).from(slackChannels).where(inArray(slackChannels.channelId, ids));
  return new Map(rows.map((r) => [r.id, `#${r.name}`]));
}

export class EventService {
  /** Upcoming events this student can see, each with whether «Нагадати за день» is on. */
  static async upcoming(userId: number, now = new Date()) {
    const rows = await db.select().from(events)
      .where(and(gt(events.startsAt, now), await visibleTo(userId)))
      .orderBy(asc(events.startsAt)).limit(60);
    const [reminded, names] = await Promise.all([this.remindedIds(userId, rows.map((r) => r.id)), slackNames(rows.map((r) => r.sourceKey))]);
    return rows.map(({ audience, userId: _owner, sourceKey, slackChannelId: _ch, ...e }) => ({
      ...e, personal: audience === 'user', reminded: reminded.has(e.id), slackChannel: names.get(slackChannelOf(sourceKey) ?? '') ?? null,
    }));
  }

  static async get(userId: number, id: number) {
    const [row] = await db.select().from(events).where(and(eq(events.id, id), await visibleTo(userId))).limit(1);
    if (!row) throw new AppError('Подію не знайдено', 404);
    const { audience, userId: _owner, sourceKey, slackChannelId: _ch, ...e } = row;
    const [reminded, names] = await Promise.all([this.remindedIds(userId, [id]), slackNames([sourceKey])]);
    return { ...e, personal: audience === 'user', reminded: reminded.has(id), slackChannel: names.get(slackChannelOf(sourceKey) ?? '') ?? null };
  }

  /** «Нагадати за день»: the bot writes the day before around 10:00. */
  static async remind(userId: number, id: number, now = new Date()) {
    const e = await this.get(userId, id);
    if (e.reminded) return { remindAt: null, reminded: true };
    const at = eventRemindAt(e.startsAt, now);
    if (!at) throw new AppError('Подія вже скоро — нагадувати пізно', 400);
    const [u] = await db.select({ languagePref: users.languagePref }).from(users).where(eq(users.id, userId)).limit(1);
    const text = eventReminderText(e, at, u?.languagePref === 'en' ? 'en' : 'uk');
    await ReminderService.create(userId, { text, remindAt: at, startapp: `event_${id}`, kind: 'event', eventId: id });
    return { remindAt: at, reminded: true };
  }

  static async unremind(userId: number, id: number) {
    await db.delete(reminders).where(and(eq(reminders.userId, userId), eq(reminders.eventId, id), isNull(reminders.sentAt)));
    return { reminded: false };
  }

  /** Events the student asked to be reminded about that happen on `day` (Kyiv), for that day's digest. */
  static async remindedOn(userId: number, dayStart: Date, dayEnd: Date) {
    return db.selectDistinct({ title: events.title, startsAt: events.startsAt, location: events.location })
      .from(reminders).innerJoin(events, eq(events.id, reminders.eventId))
      .where(and(eq(reminders.userId, userId), eq(reminders.kind, 'event'), gt(events.startsAt, dayStart), lt(events.startsAt, dayEnd)))
      .orderBy(asc(events.startsAt));
  }

  private static async remindedIds(userId: number, ids: number[]) {
    if (!ids.length) return new Set<number>();
    const rows = await db.select({ eventId: reminders.eventId }).from(reminders)
      .where(and(eq(reminders.userId, userId), eq(reminders.kind, 'event'), inArray(reminders.eventId, ids)));
    return new Set(rows.map((r) => r.eventId!));
  }
}
