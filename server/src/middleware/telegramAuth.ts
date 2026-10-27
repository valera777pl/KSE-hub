import type { Context, Next } from 'hono';
import { validateTelegramInitData, type TelegramUser } from '../utils/telegramHash.js';
import { db } from '../db/connection.js';
import { users } from '../db/schema.js';
import { eq, sql } from 'drizzle-orm';
import { verifyState } from '../utils/crypto.js';

export const SESSION_PURPOSE = 'session';
export const SESSION_TTL_S = 24 * 60 * 60;

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

  const authHeader = c.req.header('Authorization');

  // "Session <token>": what the mini app trades its initData for on open (routes/auth.ts)
  if (authHeader?.startsWith('Session ')) {
    const userId = verifyState(authHeader.slice(8), SESSION_PURPOSE);
    const [dbUser] = userId ? await db.select().from(users).where(eq(users.id, userId)) : [];
    if (!dbUser) return c.json({ error: 'Session expired', code: 'session_expired' }, 401);
    c.set('telegramUser', { id: dbUser.telegramId, first_name: dbUser.fullName, username: dbUser.username ?? undefined });
    c.set('dbUser', dbUser);
    return next();
  }

  // "tma <initData>": straight from Telegram.WebApp.initData
  if (!authHeader?.startsWith('tma ')) {
    return c.json({ error: 'Missing Telegram authorization', code: 'auth_missing' }, 401);
  }

  const initData = authHeader.slice(4); // Remove "tma " prefix
  const { valid, user } = validateTelegramInitData(initData, botToken);

  if (!valid || !user) {
    return c.json({ error: 'Invalid Telegram authorization', code: 'auth_invalid' }, 401);
  }

  // Upsert user in database
  const dbUser = await upsertUser(user);
  c.set('telegramUser', user);
  c.set('dbUser', dbUser);

  return next();
}

export async function upsertUser(tgUser: TelegramUser) {
  const fullName = [tgUser.first_name, tgUser.last_name].filter(Boolean).join(' ');

  // One atomic statement: the mini app fires several requests at once on first
  // open, and a select-then-insert would race into a duplicate-key error
  const [user] = await db
    .insert(users)
    .values({
      telegramId: tgUser.id,
      username: tgUser.username,
      fullName,
      avatarUrl: tgUser.photo_url,
      // The product is in Ukrainian; English stays available in the profile
      languagePref: 'uk',
    })
    .onConflictDoUpdate({
      target: users.telegramId,
      set: {
        username: sql`coalesce(excluded.username, ${users.username})`,
        avatarUrl: sql`coalesce(excluded.avatar_url, ${users.avatarUrl})`,
        updatedAt: new Date(),
      },
    })
    .returning();

  return user;
}
