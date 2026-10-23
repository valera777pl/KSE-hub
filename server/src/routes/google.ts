import { Hono } from 'hono';
import { html } from 'hono/html';
import { GoogleService } from '../services/googleService.js';
import { verifyState } from '../utils/crypto.js';
import { db } from '../db/connection.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { escapeHtml, sendToUser } from '../bot/send.js';
import { waitUntil } from '@vercel/functions';
import { ScheduleService } from '../services/scheduleService.js';

// GET /api/google/callback — Google redirects the browser here (no Telegram initData)
const googleCallback = new Hono();

googleCallback.get('/callback', async (c) => {
  const userId = verifyState(c.req.query('state') ?? '');
  const code = c.req.query('code');
  if (!userId) return c.html(page('Посилання застаріло', 'Повернись у KSE Hub і натисни «Підключити пошту» ще раз.'), 400);
  if (!code) return c.html(page('Доступ не надано', 'Без дозволу Google ми не можемо читати пошту. Спробуй ще раз з KSE Hub.'), 400);

  try {
    const email = await GoogleService.completeLogin(userId, code);
    // The schedule comes with the same login; fetch it in the background so the page returns now
    waitUntil(
      GoogleService.getAccount(userId)
        .then((account) => account && ScheduleService.syncAccount(account))
        .catch((err) => console.error('Initial schedule sync failed:', err))
    );
    const [user] = await db.select({ telegramId: users.telegramId }).from(users).where(eq(users.id, userId)).limit(1);
    if (user) {
      await sendToUser(user.telegramId,
        `✅ Пошту <b>${escapeHtml(email)}</b> підключено.\n\nПерші листи з'являться в дайджесті протягом 10 хвилин. Що й коли надсилати — у міні-застосунку → Профіль.`);
    }
    return c.html(page('Готово ✅', `Пошту ${email} підключено. Можна повертатися в Telegram.`));
  } catch (err: any) {
    console.error('Google callback failed:', err);
    return c.html(page('Не вийшло', err?.message ?? 'Спробуй ще раз пізніше.'), err?.status ?? 500);
  }
});

// /api/google/* behind Telegram auth — used by the mini app
const googleRoutes = new Hono();

googleRoutes.get('/status', async (c) => {
  const account = await GoogleService.getAccount(c.get('dbUser').id);
  return c.json({
    connected: !!account,
    email: account?.email ?? null,
    needsReconnect: account?.syncError === 'invalid_grant',
    lastSyncAt: account?.lastSyncAt ?? null,
  });
});

googleRoutes.get('/connect', (c) => c.json({ url: GoogleService.authUrl(c.get('dbUser').id) }));

googleRoutes.delete('/', async (c) => {
  await GoogleService.disconnect(c.get('dbUser').id);
  return c.json({ success: true });
});

function page(title: string, text: string) {
  return html`<!doctype html>
<html lang="uk"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>KSE Hub</title>
<style>body{font-family:system-ui,sans-serif;display:grid;place-items:center;min-height:100vh;margin:0;padding:16px;background:#f4f4f5;color:#111}
main{max-width:420px;text-align:center}h1{font-size:24px}a{display:inline-block;margin-top:16px;padding:12px 20px;border-radius:12px;background:#111;color:#fff;text-decoration:none}</style>
</head><body><main><h1>${title}</h1><p>${text}</p><a href="https://t.me/ksehub_bot">Відкрити бота</a></main></body></html>`;
}

export { googleCallback, googleRoutes };
