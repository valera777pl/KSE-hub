import { Api, GrammyError, InlineKeyboard } from 'grammy';
import { db } from '../db/connection.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';

let api: Api | null = null;

export function botApi(): Api {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not set');
  api ??= new Api(token);
  return api;
}

/** Public URL of the mini app (Vercel production domain, or CLIENT_URL locally). */
export function appUrl(): string {
  if (process.env.WEBAPP_URL) return process.env.WEBAPP_URL.replace(/\/$/, '');
  if (process.env.VERCEL_PROJECT_PRODUCTION_URL) return `https://${process.env.VERCEL_PROJECT_PRODUCTION_URL}`;
  return (process.env.CLIENT_URL || 'http://localhost:5173').replace(/\/$/, '');
}

export function openAppKeyboard(label = '🎓 Відкрити KSE Hub') {
  return new InlineKeyboard().webApp(label, appUrl());
}

export function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Send an HTML message to a user. If the user blocked the bot, remember it
 * so the cron stops trying; other errors are logged and swallowed.
 */
export async function sendToUser(
  telegramId: number,
  html: string,
  keyboard?: InlineKeyboard
): Promise<boolean> {
  try {
    await botApi().sendMessage(telegramId, html, {
      parse_mode: 'HTML',
      link_preview_options: { is_disabled: true },
      reply_markup: keyboard,
    });
    return true;
  } catch (err) {
    if (err instanceof GrammyError && err.error_code === 403) {
      await db.update(users).set({ botBlocked: true }).where(eq(users.telegramId, telegramId));
    } else {
      console.error(`Failed to send message to ${telegramId}:`, err);
    }
    return false;
  }
}
