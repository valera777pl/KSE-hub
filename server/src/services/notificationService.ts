import { db } from '../db/connection.js';
import { notifications, users } from '../db/schema.js';
import { eq, and, desc } from 'drizzle-orm';
import { escapeHtml, sendToUser } from '../bot/send.js';

export class NotificationService {
  /**
   * Create a notification and push it to the Telegram chat.
   */
  static async create(
    userId: number,
    type: 'deadline' | 'match' | 'booking_expiry' | 'system',
    title: string,
    message?: string,
    actionUrl?: string
  ) {
    const [notification] = await db
      .insert(notifications)
      .values({ userId, type, title, message, actionUrl })
      .returning();

    // Push to the Telegram chat
    const [user] = await db
      .select({ telegramId: users.telegramId, botBlocked: users.botBlocked })
      .from(users)
      .where(eq(users.id, userId))
      .limit(1);
    if (user && !user.botBlocked) {
      const body = message ? `\n${escapeHtml(message)}` : '';
      await sendToUser(user.telegramId, `<b>${escapeHtml(title)}</b>${body}`);
    }

    return notification;
  }

  /**
   * Get user's notifications.
   */
  static async getUserNotifications(userId: number, limit = 50) {
    return db
      .select()
      .from(notifications)
      .where(eq(notifications.userId, userId))
      .orderBy(desc(notifications.createdAt))
      .limit(limit);
  }

  /**
   * Mark notification as read.
   */
  static async markRead(notificationId: number, userId: number) {
    const [updated] = await db
      .update(notifications)
      .set({ isRead: true })
      .where(
        and(
          eq(notifications.id, notificationId),
          eq(notifications.userId, userId)
        )
      )
      .returning();
    return updated;
  }

  /**
   * Mark all as read.
   */
  static async markAllRead(userId: number) {
    await db
      .update(notifications)
      .set({ isRead: true })
      .where(
        and(
          eq(notifications.userId, userId),
          eq(notifications.isRead, false)
        )
      );
  }

  /**
   * Get unread count.
   */
  static async getUnreadCount(userId: number) {
    const result = await db
      .select()
      .from(notifications)
      .where(
        and(
          eq(notifications.userId, userId),
          eq(notifications.isRead, false)
        )
      );
    return result.length;
  }
}
