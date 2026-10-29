import type { InlineKeyboard } from 'grammy';
import { sql } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { usageEvents } from '../db/schema.js';
import { sendToUser } from '../bot/send.js';
import { AnalyticsService } from './analyticsService.js';
import { kyivDate, kyivDayStart } from '../utils/kyivTime.js';

/**
 * Kinds of messages the bot sends on its own. The type rides in the button's startapp
 * ("deadline_12__d24"), so the admin dashboard can match "sent" with "opened".
 */
export type PushType =
  | 'digest' | 'weekly' | 'd24' | 'd3' | 'change' | 'soon' | 'urgent' | 'opp'
  | 'booking_end' | 'onboarding' | 'remind' | 'friend' | 'event' | 'slack';

/**
 * At most 3 pushes a day that the student didn't ask for (NEXT-PROMPT.md §13.1).
 * Lower number = more important. Not listed = outside the budget: the digest and weekly list,
 * replies to the student's own actions, reminders they set, "class in 15 min" they turned on, friends.
 */
export const PUSH_PRIORITY: Partial<Record<PushType, number>> = { change: 1, d3: 2, urgent: 2, d24: 3, opp: 4 };
export const DAILY_PUSHES = 3;

/**
 * Whether a push fits today's budget. A schedule change always goes; the 3-hour deadline and urgent mail
 * take any free slot; the 24-hour deadline and opportunities leave the last slot for something more urgent.
 */
export function budgetAllows(type: PushType, sentToday: number): boolean {
  const priority = PUSH_PRIORITY[type];
  if (priority === undefined || priority === 1) return true;
  if (priority === 2) return sentToday < DAILY_PUSHES;
  return sentToday < DAILY_PUSHES - 1;
}

export class PushService {
  /** Counted pushes delivered to the student since midnight Kyiv. */
  static async sentToday(userId: number): Promise<number> {
    const [row] = await db.execute<{ n: number }>(sql`
      select count(*)::int as n from ${usageEvents}
      where user_id = ${userId} and event = 'push.sent' and props->>'counted' = 'true'
        and created_at >= ${kyivDayStart(kyivDate())}
    `);
    return row?.n ?? 0;
  }

  /** Check before claiming a reminder: what doesn't fit today is left for the digest or a later tick. */
  static async allowed(userId: number, type: PushType): Promise<boolean> {
    if (PUSH_PRIORITY[type] === undefined) return true;
    return budgetAllows(type, await this.sentToday(userId));
  }

  /** Send a push and record `push.sent {type}` when it was delivered. */
  static async send(user: { id: number; telegramId: number }, type: PushType, html: string, keyboard?: InlineKeyboard) {
    const ok = await sendToUser(user.telegramId, html, keyboard);
    if (!ok) return false;
    const counted = PUSH_PRIORITY[type] !== undefined;
    // Budgeted pushes are written before returning, so the next push in the same tick sees them
    if (counted) {
      await db.insert(usageEvents).values({ userId: user.id, event: 'push.sent', props: { type, counted } })
        .catch((err) => console.error('push.sent insert failed:', err));
    } else {
      AnalyticsService.track(user.id, 'push.sent', { type });
    }
    return true;
  }
}
