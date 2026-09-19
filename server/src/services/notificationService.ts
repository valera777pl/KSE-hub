import { db } from '../db/connection.js';
import { notifications } from '../db/schema.js';
import { eq, and, desc } from 'drizzle-orm';

// SSE connections store
const connections = new Map<number, Set<ReadableStreamDefaultController>>();

export class NotificationService {
  /**
   * Create a notification and push via SSE.
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

    // Push to SSE
    this.pushToUser(userId, {
      type: 'notification',
      data: notification,
    });

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

  /**
   * SSE: Register a client connection.
   */
  static addConnection(userId: number, controller: ReadableStreamDefaultController) {
    if (!connections.has(userId)) {
      connections.set(userId, new Set());
    }
    connections.get(userId)!.add(controller);
  }

  /**
   * SSE: Remove a client connection.
   */
  static removeConnection(userId: number, controller: ReadableStreamDefaultController) {
    connections.get(userId)?.delete(controller);
    if (connections.get(userId)?.size === 0) {
      connections.delete(userId);
    }
  }

  /**
   * SSE: Push event to a specific user.
   */
  static pushToUser(userId: number, payload: { type: string; data: any }) {
    const userConns = connections.get(userId);
    if (!userConns) return;

    const message = `data: ${JSON.stringify(payload)}\n\n`;
    const encoder = new TextEncoder();

    for (const controller of userConns) {
      try {
        controller.enqueue(encoder.encode(message));
      } catch {
        userConns.delete(controller);
      }
    }
  }
}
