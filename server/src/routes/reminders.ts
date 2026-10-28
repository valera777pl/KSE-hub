import { Hono } from 'hono';
import { ReminderService } from '../services/reminderService.js';
import { AppError } from '../middleware/errorHandler.js';

const reminderRoutes = new Hono();

// GET /reminders — mine that haven't gone out yet
reminderRoutes.get('/', async (c) => c.json({ reminders: await ReminderService.upcoming(c.get('dbUser').id) }));

// POST /reminders { text, remindAt, startapp? } — "Нагадати…" from a deadline, class or event
reminderRoutes.post('/', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const reminder = await ReminderService.create(c.get('dbUser').id, {
    text: String(body.text ?? ''), remindAt: new Date(body.remindAt), startapp: body.startapp ?? null,
  });
  return c.json({ reminder });
});

// POST /reminders/friend { friendId, text, assignmentId? } — a nudge to a mutual friend, sent now
reminderRoutes.post('/friend', async (c) => {
  const body = await c.req.json().catch(() => ({}));
  const friendId = Number(body.friendId);
  if (!Number.isSafeInteger(friendId)) throw new AppError('Bad friend id', 400);
  return c.json(await ReminderService.remindFriend(c.get('dbUser').id, friendId, {
    text: String(body.text ?? ''), assignmentId: Number.isSafeInteger(Number(body.assignmentId)) ? Number(body.assignmentId) : null,
  }));
});

// DELETE /reminders/:id
reminderRoutes.delete('/:id', async (c) => {
  await ReminderService.remove(c.get('dbUser').id, parseInt(c.req.param('id'), 10));
  return c.json({ ok: true });
});

export { reminderRoutes };
