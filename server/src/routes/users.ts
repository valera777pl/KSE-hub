import { Hono } from 'hono';
import { db } from '../db/connection.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { updateProfileSchema } from '../utils/validators.js';
import { GoogleService } from '../services/googleService.js';

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

// DELETE /users/me — Remove the student and everything linked to them
userRoutes.delete('/me', async (c) => {
  const user = c.get('dbUser');
  // Revoke Google access first; the rest goes with the user row (ON DELETE CASCADE)
  await GoogleService.disconnect(user.id).catch(() => {});
  await db.delete(users).where(eq(users.id, user.id));
  return c.json({ success: true });
});

export { userRoutes };
