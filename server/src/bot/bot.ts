import { Bot, Context, InlineKeyboard } from 'grammy';
import { db } from '../db/connection.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { upsertUser } from '../middleware/telegramAuth.js';
import { AIService, AILimitError } from '../ai/aiService.js';
import { AnalyticsService } from '../services/analyticsService.js';
import { signState } from '../utils/crypto.js';
import { appUrl, chunkHtml, escapeHtml, openAppKeyboard } from './send.js';

/**
 * The chat is for talking to the assistant and for receiving digests and pushes.
 * Everything else (settings, connecting mail, Moodle) lives in the mini app.
 */

type DbUser = typeof users.$inferSelect;
type BotContext = Context & { dbUser: DbUser };

export const BOT_COMMANDS = [
  { command: 'start', description: 'Відкрити KSE Hub' },
  { command: 'new', description: 'Почати нову розмову з ІІ' },
];

let bot: Bot<BotContext> | null = null;

export function getBot(): Bot<BotContext> {
  if (bot) return bot;

  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not set');
  bot = new Bot<BotContext>(token);

  // Every private update gets the student's DB row (created on first contact)
  bot.use(async (ctx, next) => {
    if (!ctx.from || ctx.chat?.type !== 'private') return;
    ctx.dbUser = await upsertUser(ctx.from);
    if (ctx.dbUser.botBlocked) {
      ctx.dbUser = (await db.update(users).set({ botBlocked: false }).where(eq(users.id, ctx.dbUser.id)).returning())[0];
    }
    await next();
  });

  bot.command('start', async (ctx) => {
    const name = escapeHtml(ctx.from!.first_name);
    AnalyticsService.track(ctx.dbUser.id, 'bot.start');
    if (!ctx.dbUser.onboardedAt) {
      await ctx.reply(
        `Привіт, ${name}! 👋\n\n` +
          `Я <b>KSE Hub</b> — Moodle, пошта, розклад і ІІ-помічник в одному місці.\n\n` +
          `Щоб почати, зареєструйся в міні-застосунку: увійди поштою @kse.org.ua — це хвилина 👇`,
        { parse_mode: 'HTML', reply_markup: openAppKeyboard('🚀 Зареєструватися') }
      );
      return;
    }
    await ctx.reply(
      `Привіт, ${name}! 👋\n\n` +
        `Я <b>KSE Hub</b>. Сюди приходитимуть дайджести з Moodle, пошти та Slack і нагадування про дедлайни.\n\n` +
        `А ще мені можна просто написати: «які в мене дедлайни на тижні?», «що писали про стажування?».\n\n` +
        `Підключення та налаштування — в міні-застосунку 👇`,
      { parse_mode: 'HTML', reply_markup: openAppKeyboard() }
    );
  });

  // Hidden: a 30-day login link to the admin dashboard, for admins only
  bot.command('admin', async (ctx) => {
    if (!ctx.dbUser.isAdmin) return;
    const token = signState(ctx.dbUser.id, 30 * 24 * 3600, 'admin');
    await ctx.reply('Адмінка KSE Hub (посилання діє 30 днів, нікому не пересилай):', {
      reply_markup: new InlineKeyboard().url('📊 Відкрити адмінку', `${appUrl()}/admin#token=${token}`),
    });
  });

  // Everything below needs a finished sign-up
  bot.use(async (ctx, next) => {
    if (ctx.dbUser.onboardedAt) return next();
    await ctx.reply('Спершу зареєструйся в міні-застосунку — увійди поштою @kse.org.ua 👇', {
      reply_markup: openAppKeyboard('🚀 Зареєструватися'),
    });
  });

  bot.command('new', async (ctx) => {
    await AIService.clearHistory(ctx.dbUser.id);
    await ctx.reply('Почали нову розмову ✨ Про що спитаєш?');
  });

  bot.on('message:text', async (ctx) => {
    await ctx.replyWithChatAction('typing');
    let content: string;
    try {
      ({ content } = await AIService.chat(ctx.dbUser.id, ctx.message.text.slice(0, 2000), 'bot'));
    } catch (err) {
      if (err instanceof AILimitError) {
        await ctx.reply(err.message);
        return;
      }
      console.error('Assistant failed:', err);
      AnalyticsService.track(ctx.dbUser.id, 'ai.error', { source: 'bot' });
      await ctx.reply('ІІ зараз перевантажений, спробуй за хвилину 🙏');
      return;
    }
    for (const chunk of chunkHtml(markdownToTelegramHtml(content))) {
      await ctx
        .reply(chunk, { parse_mode: 'HTML', link_preview_options: { is_disabled: true } })
        // Odd Markdown can turn into HTML Telegram rejects; plain text still gets the answer through
        .catch(() => ctx.reply(chunk.replace(/<[^>]+>/g, '')));
    }
  });

  bot.on('message', async (ctx) => {
    await ctx.reply('Поки я розумію лише текст ✍️');
  });

  return bot;
}

/** The assistant answers in light Markdown; Telegram wants its HTML subset. */
export function markdownToTelegramHtml(md: string): string {
  return escapeHtml(md)
    .replace(/^[ \t]*[-*][ \t]+/gm, '• ') // bullets first, so "* item" isn't read as italics
    .replace(/```(?:\w+)?\n?([\s\S]*?)```/g, '<pre>$1</pre>')
    .replace(/`([^`\n]+)`/g, '<code>$1</code>')
    .replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>')
    .replace(/(^|[^*\w])\*([^*\n]+)\*(?!\w)/g, '$1<i>$2</i>')
    .replace(/\[([^\]\n]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/^#{1,6}\s+(.+)$/gm, '<b>$1</b>');
}
