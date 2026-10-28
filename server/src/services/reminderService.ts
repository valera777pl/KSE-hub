import { InlineKeyboard } from 'grammy';
import { and, asc, eq, gte, inArray, isNull, lte, ne } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { moodleAssignments, reminderMutes, reminders, users, type ReminderKind } from '../db/schema.js';
import { AppError } from '../middleware/errorHandler.js';
import { appButton } from '../bot/messages.js';
import { activityName } from '../utils/moodleGroups.js';
import { FRIEND_REMINDERS_PER_DAY, reminderText, reminderWhen, validRemindAt } from '../utils/reminders.js';
import { kyivDate, kyivDayStart } from '../utils/kyivTime.js';
import { AnalyticsService } from './analyticsService.js';
import { FriendService } from './friendService.js';
import { PushService } from './pushService.js';

const STARTAPP = /^[A-Za-z0-9_-]{1,60}$/;
const lang = (pref: string | null) => (pref === 'en' ? 'en' as const : 'uk' as const);

export class ReminderService {
  /** "Нагадати…" from a sheet, or "нагадай мені в пт о 18…" via Copilot. */
  static async create(userId: number, input: { text: string; remindAt: Date; startapp?: string | null; kind?: 'self' | 'event'; eventId?: number | null }) {
    const text = input.text?.trim().slice(0, 300);
    if (!text) throw new AppError('Про що нагадати?', 400);
    if (!validRemindAt(input.remindAt, new Date())) throw new AppError('Цей час уже минув — обери пізніший', 400);
    const kind: ReminderKind = input.kind === 'event' ? 'event' : 'self';
    const [row] = await db.insert(reminders).values({
      userId, kind, text, remindAt: input.remindAt,
      startapp: input.startapp && STARTAPP.test(input.startapp) ? input.startapp : null,
      eventId: input.eventId ?? null,
    }).returning();
    AnalyticsService.track(userId, kind === 'event' ? 'event.remind' : 'reminder.created', { kind: 'self' });
    return row;
  }

  /** My reminders that haven't gone out yet (Профіль → Мої нагадування). */
  static upcoming(userId: number) {
    return db.select({ id: reminders.id, kind: reminders.kind, text: reminders.text, remindAt: reminders.remindAt, startapp: reminders.startapp, eventId: reminders.eventId })
      .from(reminders)
      .where(and(eq(reminders.userId, userId), isNull(reminders.sentAt), ne(reminders.kind, 'friend')))
      .orderBy(asc(reminders.remindAt));
  }

  static async remove(userId: number, id: number) {
    await db.delete(reminders).where(and(eq(reminders.id, id), eq(reminders.userId, userId), isNull(reminders.sentAt)));
  }

  /**
   * "Нагадати другу": only mutual friends, at most 5 a day, never to someone who muted me.
   * Goes out right away. The button opens the deadline only if the friend has the same one.
   */
  static async remindFriend(fromId: number, friendId: number, input: { text: string; assignmentId?: number | null }) {
    if (!(await FriendService.areFriends(fromId, friendId))) throw new AppError('Нагадувати можна лише друзям', 403);
    const [muted] = await db.select().from(reminderMutes)
      .where(and(eq(reminderMutes.userId, friendId), eq(reminderMutes.mutedUserId, fromId))).limit(1);
    if (muted) throw new AppError('Цей друг вимкнув нагадування від тебе', 403);
    const today = await db.select({ id: reminders.id }).from(reminders)
      .where(and(eq(reminders.fromUserId, fromId), gte(reminders.createdAt, kyivDayStart(kyivDate()))));
    if (today.length >= FRIEND_REMINDERS_PER_DAY) throw new AppError(`Сьогодні вже ${FRIEND_REMINDERS_PER_DAY} нагадувань друзям — завтра можна знову`, 429);

    const text = input.text?.trim().slice(0, 300);
    if (!text) throw new AppError('Про що нагадати?', 400);
    const theirs = input.assignmentId ? await this.sameDeadline(fromId, input.assignmentId, friendId) : null;

    const [from, to] = await Promise.all([fromId, friendId].map(async (id) =>
      (await db.select({ id: users.id, telegramId: users.telegramId, fullName: users.fullName, languagePref: users.languagePref, botBlocked: users.botBlocked })
        .from(users).where(eq(users.id, id)).limit(1))[0]));
    if (!to || to.botBlocked) throw new AppError('Не вдалося надіслати: друг вимкнув бота', 409);

    const [row] = await db.insert(reminders).values({
      userId: friendId, fromUserId: fromId, kind: 'friend', text, remindAt: new Date(), sentAt: new Date(),
      startapp: theirs ? `deadline_${theirs}` : null,
    }).returning();
    const l = lang(to.languagePref);
    const firstName = from.fullName.split(' ')[0];
    const keyboard = (theirs ? appButton(l === 'en' ? 'Open deadline' : 'Відкрити дедлайн', `deadline_${theirs}`, 'friend') : new InlineKeyboard()).row()
      .text(l === 'en' ? `Mute ${firstName}` : `Не отримувати від ${firstName}`, `mute:${fromId}`);
    const ok = await PushService.send({ id: to.id, telegramId: to.telegramId }, 'friend', reminderText('friend', text, l, firstName), keyboard);
    AnalyticsService.track(fromId, 'reminder.created', { kind: 'friend' });
    if (ok) AnalyticsService.track(friendId, 'reminder.sent', { kind: 'friend' });
    return { id: row.id, delivered: ok, opensDeadline: !!theirs };
  }

  /** "Не отримувати від Олега" under a friend's reminder. */
  static async mute(userId: number, mutedUserId: number) {
    await db.insert(reminderMutes).values({ userId, mutedUserId }).onConflictDoNothing();
  }

  /** The friend's own copy of my deadline: same Moodle uid, or the same activity with the same due time. */
  private static async sameDeadline(fromId: number, assignmentId: number, friendId: number): Promise<number | null> {
    const [mine] = await db.select().from(moodleAssignments).where(and(eq(moodleAssignments.id, assignmentId), eq(moodleAssignments.userId, fromId))).limit(1);
    if (!mine) return null;
    const theirs = await db.select({ id: moodleAssignments.id, externalId: moodleAssignments.externalId, title: moodleAssignments.title, dueDate: moodleAssignments.dueDate })
      .from(moodleAssignments).where(and(eq(moodleAssignments.userId, friendId), eq(moodleAssignments.hidden, false)));
    const match = theirs.find((t) => mine.externalId && t.externalId === mine.externalId)
      ?? theirs.find((t) => activityName(t.title) === activityName(mine.title) && t.dueDate?.getTime() === mine.dueDate?.getTime());
    return match?.id ?? null;
  }

  /** Cron: everything due now, once each (claimed before sending). */
  static async sendDue(now = new Date()) {
    const due = await db.select({ r: reminders, telegramId: users.telegramId, languagePref: users.languagePref })
      .from(reminders).innerJoin(users, eq(users.id, reminders.userId))
      .where(and(isNull(reminders.sentAt), lte(reminders.remindAt, now), eq(users.botBlocked, false)))
      .orderBy(asc(reminders.remindAt)).limit(50);
    if (!due.length) return 0;
    const claimed = new Set((await db.update(reminders).set({ sentAt: now })
      .where(and(inArray(reminders.id, due.map((d) => d.r.id)), isNull(reminders.sentAt)))
      .returning({ id: reminders.id })).map((r) => r.id));

    let sent = 0;
    for (const { r, telegramId, languagePref } of due) {
      if (!claimed.has(r.id)) continue;
      const l = lang(languagePref);
      const push = r.kind === 'event' ? 'event' : 'remind';
      const keyboard = r.startapp ? appButton(l === 'en' ? 'Open' : 'Відкрити', r.startapp, push) : undefined;
      if (await PushService.send({ id: r.userId, telegramId }, push, reminderText(r.kind === 'event' ? 'event' : 'self', r.text, l), keyboard)) {
        sent++;
        AnalyticsService.track(r.userId, 'reminder.sent', { kind: r.kind });
      }
    }
    return sent;
  }

  static when = reminderWhen;
}
