import { Hono, type Context, type Next } from 'hono';
import { sql } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { verifyState } from '../utils/crypto.js';
import { validateTelegramInitData } from '../utils/telegramHash.js';
import * as Metrics from '../services/adminMetrics.js';
import { FUNNEL_EVENTS } from '../services/adminMetrics.js';
import { SlackService } from '../services/slackService.js';
import { AppError } from '../middleware/errorHandler.js';
import { adminChannelSchema, adminPublishSchema } from '../utils/slackIngest.js';

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

/*
 * "Active" means the student did something: opened the mini app, a screen, wrote to the bot.
 * Pushes the server sent (digest.sent, push.sent, …) don't count, otherwise silent users look alive.
 */
const ACTIVE = sql.raw(`(e.event in ('app.open', 'ai.message', 'bot.start') or e.event like 'tab.%')`);
const TODAY = sql.raw(`(now() at time zone 'Europe/Kyiv')::date`);
const quoted = (list: readonly string[]) => sql.raw(list.map((e) => `'${e}'`).join(', '));

/** Features shown in the dashboard; tab.* come from tab.view {tab}. Add a key when its feature ships. */
const FEATURE_KEYS = [
  'tab.today', 'tab.schedule', 'tab.deadlines', 'tab.rooms', 'tab.forYou', 'tab.startups', 'tab.people', 'tab.profile',
  'ai.message', 'booking.created', 'deadline.sheet_open', 'deadline.done', 'deadline.moodle_open',
  'schedule.friend_added', 'opp.apply_click', 'opp.saved',
  'friend.request', 'invite.sent', 'reminder.created', 'deadline.feedback_open',
  'tab.events', 'event.open', 'event.remind', 'pinned.set', 'course.open',
] as const;

// GET /api/admin/analytics?days=7|14|30 — everything the dashboard draws, in one request
adminRoutes.get('/analytics', async (c) => {
  const days = Math.min(Math.max(parseInt(c.req.query('days') ?? '7', 10) || 7, 1), 90);
  const since = sql`now() - make_interval(days => ${days})`;
  const prevSince = sql`now() - make_interval(days => ${days * 2})`;

  const [counts] = await db.execute<Record<string, number | string>>(sql`
    select
      to_char(${TODAY}, 'YYYY-MM-DD') as today,
      (select count(distinct user_id) from usage_events e where ${ACTIVE} and ${kyivDay('e.created_at')} = ${TODAY})::int as dau,
      (select count(distinct user_id) from usage_events e where ${ACTIVE} and e.created_at > now() - interval '7 days')::int as wau,
      (select count(distinct user_id) from usage_events e where ${ACTIVE} and e.created_at > ${since})::int as active,
      (select count(*) from users u where ${kyivDay('u.created_at')} = ${TODAY})::int as new_today,
      (select count(*) from users)::int as users,
      (select count(*) from users where onboarded_at is not null)::int as onboarded,
      (select count(*) from google_accounts where sync_error = 'invalid_grant')::int as mail_revoked,
      (select count(*) from users u where onboarded_at is not null and not exists (select 1 from user_calendars uc where uc.user_id = u.id))::int as no_schedule,
      (select count(*) from users where onboarded_at is not null and calendar_url is null)::int as no_moodle,
      (select count(*) from usage_events where event = 'digest.failed' and created_at > ${since})::int as digest_failed,
      (select count(*) from users where bot_blocked)::int as bot_blocked,
      (select count(*) from usage_events where event = 'ai.message' and created_at > ${since})::int as ai_messages,
      (select count(*) from usage_events where event = 'ai.limit_hit' and created_at > ${since})::int as ai_limit_hits,
      (select count(*) from usage_events where event = 'ai.error' and created_at > ${since})::int as ai_errors,
      (select count(*) from usage_events where event = 'friend.request' and created_at > ${since})::int as friend_requests,
      (select count(*) from usage_events where event = 'friend.accept' and created_at > ${since})::int as friend_accepts,
      (select count(*) from usage_events where event = 'invite.sent' and created_at > ${since})::int as invites_sent,
      (select count(distinct user_id) from usage_events where event = 'invite.sent' and created_at > ${since})::int as inviters,
      (select count(*) from usage_events where event = 'invite.joined' and created_at > ${since})::int as invites_joined
  `);
  const n = (key: string) => Number(counts[key] ?? 0);
  const today = String(counts.today);

  const daily = await db.execute<{ day: string; active: number; new_users: number; ai: number }>(sql`
    with d as (
      select generate_series(${TODAY} - (${days} - 1), ${TODAY}, interval '1 day')::date as day
    )
    select to_char(d.day, 'YYYY-MM-DD') as day,
      (select count(distinct user_id) from usage_events e where ${ACTIVE} and ${kyivDay('e.created_at')} = d.day)::int as active,
      (select count(*) from users u where ${kyivDay('u.created_at')} = d.day)::int as new_users,
      (select count(*) from usage_events e where e.event = 'ai.message' and ${kyivDay('e.created_at')} = d.day)::int as ai
    from d order by d.day
  `);

  // Every onboarded student of the last 10 weeks: their onboarding day and the days (after it) they were active
  const activity = await db.execute<{ day: string; offsets: number[] }>(sql`
    select to_char(${kyivDay('u.onboarded_at')}, 'YYYY-MM-DD') as day,
      coalesce(array_agg(distinct (${kyivDay('e.created_at')} - ${kyivDay('u.onboarded_at')})) filter (where e.id is not null), '{}') as offsets
    from users u
    left join usage_events e on e.user_id = u.id and ${ACTIVE}
    where u.onboarded_at > now() - interval '70 days'
    group by u.id, u.onboarded_at
  `);
  const onboardedRecently = [...activity].map((r) => ({ day: r.day, offsets: (r.offsets ?? []).map(Number) }));
  const periodStart = new Date(Date.parse(today) - (days - 1) * 86_400_000).toISOString().slice(0, 10);
  // Activation needs the next day to be over: onboarded in the period, at least two days ago
  const activationBase = onboardedRecently.filter((u) => u.day >= periodStart && Date.parse(today) - Date.parse(u.day) >= 2 * 86_400_000);

  const newUsers = await db.execute<{ events: string[] }>(sql`
    select coalesce(array_agg(distinct e.event) filter (where e.id is not null), '{}') as events
    from users u
    left join usage_events e on e.user_id = u.id and e.event in (${quoted(FUNNEL_EVENTS)})
    where u.created_at > ${since}
    group by u.id
  `);

  const featureRows = await db.execute<{ key: string; users: number; prev: number }>(sql`
    select key,
      count(distinct user_id) filter (where created_at > ${since})::int as users,
      count(distinct user_id) filter (where created_at <= ${since})::int as prev
    from (
      select user_id, created_at, case when event = 'tab.view' then 'tab.' || (props->>'tab') else event end as key
      from usage_events where created_at > ${prevSince}
    ) t
    where key in (${quoted(FEATURE_KEYS)})
    group by key
  `);

  const pushRows = await db.execute<{ event: string; type: string; n: number }>(sql`
    select event, props->>'type' as type, count(*)::int as n
    from usage_events
    where event in ('push.sent', 'push.open') and created_at > ${since} and props->>'type' is not null
    group by 1, 2
  `);

  const tools = await db.execute<{ name: string; times: number }>(sql`
    select props->>'name' as name, count(*)::int as times
    from usage_events where event = 'ai.tool' and created_at > ${since}
    group by 1 order by 2 desc limit 8
  `);
  const topics = await db.execute<{ topic: string; times: number }>(sql`
    select props->>'topic' as topic, count(*)::int as times
    from usage_events where event = 'ai.topic' and created_at > ${since}
    group by 1 order by 2 desc
  `);

  // Mutual friends arrive with migration 011; until then the number is simply unknown
  const avgFriends = await db.execute<{ avg: number | null }>(sql`
    select round(avg(n)::numeric, 1)::float as avg from (
      select u.id, count(f.*) as n from users u
      left join friendships f on f.status = 'accepted' and u.id in (f.requester_id, f.addressee_id)
      where u.onboarded_at is not null group by u.id
    ) t
  `).then((rows) => rows[0]?.avg ?? null).catch(() => null);

  const byEvent = (event: string) => [...pushRows].filter((r) => r.event === event).map((r) => ({ type: r.type, n: r.n }));
  const active = n('active');

  return c.json({
    days,
    today,
    pulse: {
      dau: n('dau'), wau: n('wau'), active, newToday: n('new_today'), users: n('users'), onboarded: n('onboarded'),
      activation: Metrics.activation(activationBase),
      daily: [...daily].map((d) => ({ day: d.day, active: d.active, newUsers: d.new_users })),
    },
    funnel: Metrics.funnel([...newUsers].map((r) => r.events ?? [])),
    retention: Metrics.retention(onboardedRecently, today).slice(0, 8),
    features: Metrics.features([...featureRows], active, FEATURE_KEYS),
    pushes: Metrics.pushes(byEvent('push.sent'), byEvent('push.open')),
    ai: {
      daily: [...daily].map((d) => ({ day: d.day, messages: d.ai })),
      messages: n('ai_messages'),
      perActive: active ? Math.round((n('ai_messages') / active) * 10) / 10 : 0,
      limitHits: n('ai_limit_hits'),
      errors: n('ai_errors'),
      tools: [...tools],
      topics: [...topics],
    },
    friends: {
      requests: n('friend_requests'), accepted: n('friend_accepts'),
      invitesSent: n('invites_sent'), inviters: n('inviters'), joined: n('invites_joined'),
      inviteRate: n('inviters') ? Math.round((n('invites_joined') / n('inviters')) * 10) / 10 : 0,
      avgFriends,
    },
    health: Metrics.health({
      mail_revoked: n('mail_revoked'), no_schedule: n('no_schedule'), no_moodle: n('no_moodle'),
      digest_failed: n('digest_failed'), bot_blocked: n('bot_blocked'),
    }, n('onboarded')),
  });
});

/* ─── Slack digests: channels and drafts (SLACK-DIGEST-PROMPT.md §5.2) ─── */

const summaryId = (v: string) => {
  const id = parseInt(v, 10);
  if (!Number.isSafeInteger(id)) throw new AppError('Bad id', 400);
  return id;
};

// GET /api/admin/slack — drafts waiting for review, every channel with its tie
adminRoutes.get('/slack', async (c) => c.json(await SlackService.adminOverview()));

// PATCH /api/admin/slack/channels/:id — tie to a course or cohort, hide, auto-publish
adminRoutes.patch('/slack/channels/:id', async (c) => {
  const patch = adminChannelSchema.parse(await c.req.json());
  return c.json({ channel: await SlackService.updateChannel(c.req.param('id'), patch) });
});

// POST /api/admin/slack/summaries/:id/publish — as is, or with the owner's edited points
adminRoutes.post('/slack/summaries/:id/publish', async (c) => {
  const body = adminPublishSchema.parse(await c.req.json().catch(() => ({})));
  return c.json({ summary: await SlackService.publish(summaryId(c.req.param('id')), body.items ? { items: body.items } : undefined) });
});

// POST /api/admin/slack/summaries/:id/reject
adminRoutes.post('/slack/summaries/:id/reject', async (c) => c.json(await SlackService.reject(summaryId(c.req.param('id')))));

export { adminRoutes };
