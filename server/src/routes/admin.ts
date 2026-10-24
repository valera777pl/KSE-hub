import { Hono, type Context, type Next } from 'hono';
import { sql } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { verifyState } from '../utils/crypto.js';
import { validateTelegramInitData } from '../utils/telegramHash.js';

/**
 * Admin dashboard API. Two ways in:
 *  - "Admin <token>": the 30-day link the bot's /admin command sends (works in any browser)
 *  - "tma <initData>": opened from inside the mini app by an admin
 */
async function adminAuth(c: Context, next: Next) {
  const header = c.req.header('Authorization') ?? '';
  let userId: number | null = null;
  if (header.startsWith('Admin ')) {
    userId = verifyState(header.slice(6), 'admin');
  } else if (header.startsWith('tma ')) {
    const { valid, user } = validateTelegramInitData(header.slice(4), process.env.TELEGRAM_BOT_TOKEN ?? '');
    if (valid && user) {
      const rows = await db.execute<{ id: number }>(sql`select id from users where telegram_id = ${user.id}`);
      userId = rows[0]?.id ?? null;
    }
  }
  if (!userId) return c.json({ error: 'Unauthorized' }, 401);
  const rows = await db.execute<{ is_admin: boolean }>(sql`select is_admin from users where id = ${userId}`);
  if (!rows[0]?.is_admin) return c.json({ error: 'Forbidden' }, 403);
  return next();
}

const adminRoutes = new Hono();
adminRoutes.use('*', adminAuth);

// Kyiv calendar day of a UTC `timestamp` column
const kyivDay = (column: string) => sql.raw(`((${column} at time zone 'UTC') at time zone 'Europe/Kyiv')::date`);

// GET /api/admin/stats?days=14
adminRoutes.get('/stats', async (c) => {
  const days = Math.min(Math.max(parseInt(c.req.query('days') ?? '14', 10) || 14, 1), 90);
  const since = sql`now() - make_interval(days => ${days})`;

  const [totals] = await db.execute<Record<string, number>>(sql`
    select
      (select count(*) from users)::int as users,
      (select count(*) from users where onboarded_at is not null)::int as onboarded,
      (select count(*) from google_accounts)::int as mail_connected,
      (select count(*) from google_accounts where sync_error = 'invalid_grant')::int as mail_revoked,
      (select count(distinct user_id) from user_calendars)::int as schedule_synced,
      (select count(*) from users where calendar_url is not null)::int as moodle_connected,
      (select count(*) from users where bot_blocked)::int as bot_blocked,
      (select count(*) from users where not schedule_visible)::int as schedule_hidden,
      (select count(distinct user_id) from usage_events where created_at > now() - interval '1 day')::int as active_24h,
      (select count(distinct user_id) from usage_events where created_at > now() - interval '7 days')::int as active_7d
  `);

  const daily = await db.execute<{ day: string; active: number; new_users: number; ai: number }>(sql`
    with d as (
      select generate_series((now() at time zone 'Europe/Kyiv')::date - (${days} - 1), (now() at time zone 'Europe/Kyiv')::date, interval '1 day')::date as day
    )
    select to_char(d.day, 'YYYY-MM-DD') as day,
      (select count(distinct user_id) from usage_events e where ${kyivDay('e.created_at')} = d.day)::int as active,
      (select count(*) from users u where ${kyivDay('u.created_at')} = d.day)::int as new_users,
      (select count(*) from usage_events e where e.event = 'ai.message' and ${kyivDay('e.created_at')} = d.day)::int as ai
    from d order by d.day
  `);

  const features = await db.execute<{ event: string; times: number; users: number }>(sql`
    select event, count(*)::int as times, count(distinct user_id)::int as users
    from usage_events where created_at > ${since}
    group by event order by times desc
  `);

  const tools = await db.execute<{ name: string; times: number }>(sql`
    select props->>'name' as name, count(*)::int as times
    from usage_events where event = 'ai.tool' and created_at > ${since}
    group by 1 order by 2 desc
  `);

  return c.json({ days, totals, daily, features, tools });
});

export { adminRoutes };
