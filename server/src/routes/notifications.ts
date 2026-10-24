import { Hono } from 'hono';
import { NotificationService } from '../services/notificationService.js';

const notificationRoutes = new Hono();

// GET /notifications — Get user's notifications
notificationRoutes.get('/', async (c) => {
  const user = c.get('dbUser');
  const notifications = await NotificationService.getUserNotifications(user.id);
  const unreadCount = await NotificationService.getUnreadCount(user.id);
  return c.json({ notifications, unreadCount });
});

// PATCH /notifications/:id/read — Mark as read
notificationRoutes.patch('/:id/read', async (c) => {
  const notifId = parseInt(c.req.param('id'));
  const user = c.get('dbUser');
  const notification = await NotificationService.markRead(notifId, user.id);
  return c.json({ notification });
});

// PATCH /notifications/read-all — Mark all as read
notificationRoutes.patch('/read-all', async (c) => {
  const user = c.get('dbUser');
  await NotificationService.markAllRead(user.id);
  return c.json({ success: true });
});

export { notificationRoutes };
