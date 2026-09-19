import { Hono } from 'hono';
import { db } from '../db/connection.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { updateProfileSchema } from '../utils/validators.js';

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

  const [updated] = await db
    .update(users)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(users.id, currentUser.id))
    .returning();

  return c.json({ user: updated });
});

export { userRoutes };
