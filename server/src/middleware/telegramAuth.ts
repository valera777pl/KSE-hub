import type { Context, Next } from 'hono';
import { validateTelegramInitData, type TelegramUser } from '../utils/telegramHash.js';
import { db } from '../db/connection.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';

// Extend Hono context with user data
declare module 'hono' {
  interface ContextVariableMap {
    telegramUser: TelegramUser;
    dbUser: typeof users.$inferSelect;
  }
}

/**
 * Middleware: Validates Telegram initData and attaches user to context.
 * Creates user in DB on first login (upsert).
 */
export async function telegramAuth(c: Context, next: Next) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN;
  if (!botToken) {
    return c.json({ error: 'Server misconfigured: missing bot token' }, 500);
  }

  // In development, allow a bypass header
  if (process.env.NODE_ENV === 'development') {
    const devUserId = c.req.header('X-Dev-User-Id');
    if (devUserId) {
      const tgUser: TelegramUser = {
        id: parseInt(devUserId),
        first_name: 'Dev',
        last_name: 'User',
        username: 'devuser',
      };

      // Upsert dev user
      const dbUser = await upsertUser(tgUser);
      c.set('telegramUser', tgUser);
      c.set('dbUser', dbUser);
      return next();
    }
  }

  // Get initData from Authorization header
  const authHeader = c.req.header('Authorization');
  if (!authHeader?.startsWith('tma ')) {
    return c.json({ error: 'Missing Telegram authorization' }, 401);
  }

  const initData = authHeader.slice(4); // Remove "tma " prefix
  const { valid, user } = validateTelegramInitData(initData, botToken);

  if (!valid || !user) {
    return c.json({ error: 'Invalid Telegram authorization' }, 401);
  }

  // Upsert user in database
  const dbUser = await upsertUser(user);
  c.set('telegramUser', user);
  c.set('dbUser', dbUser);

  return next();
}

async function upsertUser(tgUser: TelegramUser) {
  const fullName = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ');

  const existing = await db
    .select()
    .from(users)
    .where(eq(users.telegramId, tgUser.id))
    .limit(1);

  if (existing.length > 0) {
    // Update username/avatar if changed
    const [updated] = await db
      .update(users)
      .set({
        username: tgUser.username || existing[0].username,
        avatarUrl: tgUser.photo_url || existing[0].avatarUrl,
        updatedAt: new Date(),
      })
      .where(eq(users.telegramId, tgUser.id))
      .returning();
    return updated;
  }

  // Create new user
  const [newUser] = await db
    .insert(users)
    .values({
      telegramId: tgUser.id,
      username: tgUser.username,
      fullName,
      avatarUrl: tgUser.photo_url,
      languagePref: tgUser.language_code === 'uk' ? 'uk' : 'en',
    })
    .returning();

  return newUser;
}
