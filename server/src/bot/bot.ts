import { Bot, Context, InlineKeyboard } from 'grammy';
import { db } from '../db/connection.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { upsertUser } from '../middleware/telegramAuth.js';
import { AIService, AILimitError } from '../ai/aiService.js';
import { AnalyticsService } from '../services/analyticsService.js';
import { StartupService, contactLink, displayName } from '../services/startupService.js';
import { signState } from '../utils/crypto.js';
import { appUrl, chunkHtml, escapeHtml } from './send.js';
import { appButton } from './messages.js';
import { BookingService } from '../services/bookingService.js';

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
    const en = ctx.dbUser.languagePref === 'en';
    if (!ctx.dbUser.onboardedAt) {
      await ctx.reply(en ? `Hi, ${name}. Setup takes a minute.` : `Привіт, ${name}. Налаштування займе хвилину.`, {
        parse_mode: 'HTML', reply_markup: appButton(en ? 'Open KSE Hub' : 'Відкрити KSE Hub'),
      });
      return;
    }
    await ctx.reply(
      en
        ? `Hi, ${name}. Your digest, class changes and deadline reminders arrive here.\n\nYou can also just ask: “what's due by Friday?”`
        : `Привіт, ${name}. Сюди приходять дайджест, перенесення пар і нагадування про дедлайни.\n\nА ще можна просто спитати: «що мені здати до пʼятниці?»`,
      { parse_mode: 'HTML', reply_markup: appButton(en ? 'Open KSE Hub' : 'Відкрити KSE Hub', 'today') }
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
    await ctx.reply('Спершу увійди поштою @kse.org.ua — це хвилина.', {
      reply_markup: appButton('Відкрити KSE Hub'),
    });
  });

  // Startup author answers an application right from the notification
  bot.callbackQuery(/^vapp:(a|d):(\d+)$/, async (ctx) => {
    const accept = ctx.match[1] === 'a';
    try {
      const { application, applicant, alreadyDecided } = await StartupService.decide(ctx.dbUser.id, parseInt(ctx.match[2], 10), accept);
      await ctx.answerCallbackQuery(alreadyDecided ? 'Вже вирішено' : accept ? 'Прийнято' : 'Відхилено');
      const outcome = application.status === 'accepted'
        ? `\n\n✅ Прийнято. Напиши: <a href="${contactLink(applicant)}">${escapeHtml(displayName(applicant))}</a>`
        : '\n\n❌ Відхилено';
      await ctx.editMessageText(`${escapeHtml(ctx.callbackQuery.message?.text ?? '')}${outcome}`, { parse_mode: 'HTML' });
    } catch (err: any) {
      await ctx.answerCallbackQuery(err?.message ?? 'Не вийшло');
    }
  });

  // "Звільнити" under a booking confirmation
  bot.callbackQuery(/^book:x:(\d+)$/, async (ctx) => {
    const en = ctx.dbUser.languagePref === 'en';
    try {
      await BookingService.cancelBooking(parseInt(ctx.match[1], 10), ctx.dbUser.id);
      await ctx.answerCallbackQuery(en ? 'Released' : 'Звільнено');
      await ctx.editMessageText(`${escapeHtml(ctx.callbackQuery.message?.text ?? '')}\n\n${en ? 'Released.' : 'Звільнено.'}`, { parse_mode: 'HTML' });
    } catch (err: any) {
      await ctx.answerCallbackQuery(err?.message ?? (en ? "Couldn't release" : 'Не вийшло звільнити'));
    }
  });

  bot.command('new', async (ctx) => {
    await AIService.clearHistory(ctx.dbUser.id);
    await ctx.reply('Почали нову розмову. Про що спитаєш?');
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
      await ctx.reply('Copilot зараз перевантажений. Спробуй за хвилину.');
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
    .replace(/^#{1,6}\s+(.+)$/gm, '<b>$1</b>')
    // "> " lines (escaped to "&gt; ") become one collapsible quote: details stay out of the way
    .replace(/(?:^&gt;[ \t]?.*(?:\n|$))+/gm, (block) =>
      `<blockquote expandable>${block.replace(/^&gt;[ \t]?/gm, '').trimEnd()}</blockquote>\n`)
    .trimEnd();
}
