import { Hono } from 'hono';
import { sendToUser } from '../bot/send.js';
import { appButton, onboardedText } from '../bot/messages.js';
import { kyivHour } from '../utils/kyivTime.js';
import { db } from '../db/connection.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { updateProfileSchema } from '../utils/validators.js';
import { GoogleService } from '../services/googleService.js';
import { AnalyticsService, CLIENT_EVENTS } from '../services/analyticsService.js';
import { AppError } from '../middleware/errorHandler.js';

const userRoutes = new Hono();

// GET /users/me — Get current user profile
userRoutes.get('/me', async (c) => {
  const user = c.get('dbUser');
  return c.json({ user });
});

// PATCH /users/me — Update profile
userRoutes.patch('/me', async (c) => {
  const currentUser = c.get('dbUser');
  const body = await c.req.json();
  const data = updateProfileSchema.parse(body);
  if (data.digestSources) {
    // Canonical order, no duplicates: the digest sections always come out the same way
    data.digestSources = (['moodle', 'gmail', 'slack'] as const).filter((s) => data.digestSources!.includes(s));
  }

  const [updated] = await db
    .update(users)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(users.id, currentUser.id))
    .returning();

  return c.json({ user: updated });
});

// POST /users/me/onboarding — finish sign-up; requires a connected KSE mail
userRoutes.post('/me/onboarding', async (c) => {
  const user = c.get('dbUser');
  if (!(await GoogleService.getAccount(user.id))) throw new AppError('Спершу увійди поштою @kse.org.ua', 400);
  const [updated] = await db
    .update(users)
    .set({ onboardedAt: user.onboardedAt ?? new Date(), updatedAt: new Date() })
    .where(eq(users.id, user.id))
    .returning();
  if (!user.onboardedAt) {
    AnalyticsService.track(user.id, 'onboarding.completed');
    const hour = kyivHour();
    await sendToUser(user.telegramId, onboardedText(user.languagePref === 'en' ? 'en' : 'uk', user.digestHour, hour), appButton(user.languagePref === 'en' ? 'Open KSE Hub' : 'Відкрити KSE Hub', 'today'));
  }
  return c.json({ user: updated });
});

// POST /users/me/events — the mini app reports screen views ({ event: "tab.schedule" })
userRoutes.post('/me/events', async (c) => {
  const { event } = await c.req.json().catch(() => ({ event: '' }));
  if (typeof event === 'string' && CLIENT_EVENTS.test(event)) AnalyticsService.track(c.get('dbUser').id, event);
  return c.json({ ok: true });
});

// DELETE /users/me — Remove the student and everything linked to them
userRoutes.delete('/me', async (c) => {
  const user = c.get('dbUser');
  // Revoke Google access first; the rest goes with the user row (ON DELETE CASCADE)
  await GoogleService.disconnect(user.id).catch(() => {});
  await db.delete(users).where(eq(users.id, user.id));
  return c.json({ success: true });
});

export { userRoutes };
