import type { InlineKeyboard } from 'grammy';
import { sendToUser } from '../bot/send.js';
import { AnalyticsService } from './analyticsService.js';

/**
 * Kinds of messages the bot sends on its own. The type rides in the button's startapp
 * ("deadline_12__d24"), so the admin dashboard can match "sent" with "opened".
 */
export type PushType =
  | 'digest' | 'weekly' | 'd24' | 'd3' | 'change' | 'soon' | 'urgent' | 'opp'
  | 'booking_end' | 'onboarding' | 'remind' | 'friend' | 'event';

export class PushService {
  /** Send a push and record `push.sent {type}` when it was delivered. */
  static async send(user: { id: number; telegramId: number }, type: PushType, html: string, keyboard?: InlineKeyboard) {
    const ok = await sendToUser(user.telegramId, html, keyboard);
    if (ok) AnalyticsService.track(user.id, 'push.sent', { type });
    return ok;
  }
}
