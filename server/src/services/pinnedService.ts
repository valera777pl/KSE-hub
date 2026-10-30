import { and, eq, isNotNull, ne, or } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { users } from '../db/schema.js';
import { botApi } from '../bot/send.js';
import { isGeneralCourse } from '../bot/messages.js';
import { dayLine, nextClassLine, nextDeadlineLine } from '../utils/pinned.js';
import { DigestService } from './digestService.js';
import { ScheduleService } from './scheduleService.js';

type User = typeof users.$inferSelect;
const DAY = 86_400_000;

/**
 * The live pinned message (NEXT-PROMPT.md §13.2): one line at the top of the bot chat, edited by the cron
 * only when its text changes, never with a notification. Off → unpinned and deleted.
 */
export class PinnedService {
  static async textFor(user: User, now = new Date()): Promise<string | null> {
    const lang = user.languagePref === 'en' ? 'en' : 'uk';
    const needsClasses = user.pinnedKind === 'next' || user.pinnedKind === 'day';
    const needsDeadlines = user.pinnedKind === 'deadline' || user.pinnedKind === 'day';
    const classes = needsClasses ? await ScheduleService.events(user.id, new Date(now.getTime() - DAY), new Date(now.getTime() + 8 * DAY)) : [];
    const deadlines = needsDeadlines
      ? (await DigestService.upcomingDeadlines(user.id, now, new Date(now.getTime() + 14 * DAY), 20))
          .filter((r) => !isGeneralCourse(r.courseName))
          .map((r) => ({ title: r.assignment.title, courseName: r.courseName, dueDate: r.assignment.dueDate! }))
      : [];
    switch (user.pinnedKind) {
      case 'next': return nextClassLine(classes, now, lang);
      case 'deadline': return nextDeadlineLine(deadlines, now, lang);
      case 'day': return dayLine(classes, deadlines, now, lang);
      default: return null;
    }
  }

  /** Bring one student's pinned message up to date. */
  static async refresh(user: User, now = new Date()) {
    if (user.botBlocked) return;
    const api = botApi();
    const chat = user.telegramId;

    if (user.pinnedKind === 'off') {
      if (!user.pinnedMessageId) return;
      await api.unpinChatMessage(chat, user.pinnedMessageId).catch(() => {});
      await api.deleteMessage(chat, user.pinnedMessageId).catch(() => {});
      await db.update(users).set({ pinnedMessageId: null, pinnedText: null }).where(eq(users.id, user.id));
      return;
    }

    const text = await this.textFor(user, now);
    if (!text || (text === user.pinnedText && user.pinnedMessageId)) return;

    if (user.pinnedMessageId) {
      const edited = await api.editMessageText(chat, user.pinnedMessageId, text).then(() => true).catch(() => false);
      if (edited) {
        await db.update(users).set({ pinnedText: text }).where(eq(users.id, user.id));
        return;
      }
      // Deleted by the student or too old to edit: post a fresh one
    }
    const msg = await api.sendMessage(chat, text, { disable_notification: true, link_preview_options: { is_disabled: true } });
    await api.pinChatMessage(chat, msg.message_id, { disable_notification: true }).catch(() => {});
    if (user.pinnedMessageId) await api.deleteMessage(chat, user.pinnedMessageId).catch(() => {});
    await db.update(users).set({ pinnedMessageId: msg.message_id, pinnedText: text }).where(eq(users.id, user.id));
  }

  /** Cron: everyone with a pinned message on (or one left to take down); not before sign-up is done — there's no schedule yet. */
  static async tick(now = new Date()) {
    const due = await db.select().from(users)
      .where(and(eq(users.botBlocked, false), or(and(ne(users.pinnedKind, 'off'), isNotNull(users.onboardedAt)), isNotNull(users.pinnedMessageId))));
    let updated = 0;
    for (const user of due) {
      try {
        await this.refresh(user, now);
        updated++;
      } catch (err) {
        console.error(`Pinned message failed for user ${user.id}:`, err);
      }
    }
    return updated;
  }
}
