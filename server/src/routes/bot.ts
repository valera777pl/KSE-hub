import { Hono, type Context } from 'hono';
import { createHash, timingSafeEqual } from 'crypto';
import { waitUntil } from '@vercel/functions';
import type { Update } from 'grammy/types';
import { BOT_COMMANDS, getBot } from '../bot/bot.js';
import { appUrl } from '../bot/send.js';
import { CronService } from '../services/cronService.js';

const botRoutes = new Hono();

/** Telegram only allows [A-Za-z0-9_-] in the webhook secret, so derive one from BOT_SECRET. */
function webhookSecret(): string {
  return createHash('sha256').update(`webhook:${process.env.BOT_SECRET ?? ''}`).digest('hex');
}

function hasBearer(c: Context, secret: string | undefined): boolean {
  if (!secret) return false;
  const given = Buffer.from(c.req.header('Authorization') ?? '');
  const expected = Buffer.from(`Bearer ${secret}`);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

// POST /bot/webhook — Telegram delivers updates here
botRoutes.post('/webhook', async (c) => {
  if (c.req.header('X-Telegram-Bot-Api-Secret-Token') !== webhookSecret()) {
    return c.json({ error: 'Unauthorized' }, 401);
  }
  // Ack right away and finish in the background: AI replies can take longer than
  // Telegram waits, and a slow or non-2xx answer makes it redeliver the update
  const update = await c.req.json<Update>();
  waitUntil(handleUpdate(update));
  return c.json({ ok: true });
});

async function handleUpdate(update: Update) {
  try {
    const bot = getBot();
    if (!bot.isInited()) await bot.init();
    await bot.handleUpdate(update);
  } catch (err) {
    console.error('Bot update failed:', err);
  }
}

// POST /bot/setup — one-time: point Telegram at this deployment (Authorization: Bearer BOT_SECRET)
botRoutes.post('/setup', async (c) => {
  if (!hasBearer(c, process.env.BOT_SECRET)) return c.json({ error: 'Unauthorized' }, 401);

  const api = getBot().api;
  const url = appUrl();
  await api.setWebhook(`${url}/bot/webhook`, {
    secret_token: webhookSecret(),
    allowed_updates: ['message', 'callback_query'],
    drop_pending_updates: true,
  });
  await api.setMyCommands(BOT_COMMANDS);
  await api.setChatMenuButton({ menu_button: { type: 'web_app', text: 'KSE Hub', web_app: { url } } });

  return c.json({ ok: true, webhook: `${url}/bot/webhook`, webapp: url });
});

const cronRoutes = new Hono();

// GET|POST /cron/tick — called every ~10 min by GitHub Actions (Authorization: Bearer CRON_SECRET)
cronRoutes.on(['GET', 'POST'], '/tick', async (c) => {
  if (!hasBearer(c, process.env.CRON_SECRET)) return c.json({ error: 'Unauthorized' }, 401);
  const result = await CronService.tick();
  return c.json({ ok: true, ...result });
});

export { botRoutes, cronRoutes };
