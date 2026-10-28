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

let username: string | null = null;

/** The bot's @username, for t.me links (asked from Telegram once per instance). */
export async function botUsername(): Promise<string> {
  username ??= process.env.BOT_USERNAME || (await botApi().getMe()).username;
  return username;
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

const TELEGRAM_LIMIT = 4096;

/** Split at blank lines so no chunk exceeds Telegram's limit (tags never span paragraphs here). */
export function chunkHtml(html: string, limit = TELEGRAM_LIMIT - 96): string[] {
  const chunks: string[] = [];
  let current = '';
  // An oversized paragraph is split into its lines; each line keeps its own tags closed
  const pieces = html.split('\n\n').flatMap((para) => (para.length > limit ? para.split('\n') : [para]));
  for (const piece of pieces) {
    if (current && current.length + piece.length + 2 > limit) {
      chunks.push(current);
      current = piece;
    } else {
      current = current ? `${current}\n\n${piece}` : piece;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/**
 * Send an HTML message to a user, split into several if it's too long.
 * If the user blocked the bot, remember it so the cron stops trying;
 * other errors are logged and swallowed.
 */
export async function sendToUser(
  telegramId: number,
  html: string,
  keyboard?: InlineKeyboard
): Promise<boolean> {
  try {
    const chunks = chunkHtml(html);
    for (const [i, chunk] of chunks.entries()) {
      await botApi().sendMessage(telegramId, chunk, {
        parse_mode: 'HTML',
        link_preview_options: { is_disabled: true },
        // Buttons go under the last part
        reply_markup: i === chunks.length - 1 ? keyboard : undefined,
      });
    }
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
