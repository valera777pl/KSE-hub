import { Bot, Context, InlineKeyboard } from 'grammy';
import { db } from '../db/connection.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { upsertUser } from '../middleware/telegramAuth.js';
import { AIService, AILimitError } from '../ai/aiService.js';
import { AnalyticsService } from '../services/analyticsService.js';
import { StartupService, contactLink, displayName } from '../services/startupService.js';
import { signState, verifyInvite } from '../utils/crypto.js';
import { FriendService } from '../services/friendService.js';
import { ReminderService } from '../services/reminderService.js';
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
    // t.me/<bot>?start=inv_<code>: remember who invited a newcomer; they become friends after onboarding
    const inviterId = typeof ctx.match === 'string' && ctx.match.startsWith('inv_') ? verifyInvite(ctx.match.slice(4)) : null;
    if (inviterId && inviterId !== ctx.dbUser.id && !ctx.dbUser.onboardedAt && !ctx.dbUser.invitedBy) {
      await db.update(users).set({ invitedBy: inviterId }).where(eq(users.id, ctx.dbUser.id)).catch(() => {});
    }
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

  // A friend request answered from the message
  bot.callbackQuery(/^fr:(a|d):(\d+)$/, async (ctx) => {
    const accept = ctx.match[1] === 'a';
    const en = ctx.dbUser.languagePref === 'en';
    try {
      const { status, alreadyDecided } = await FriendService.respond(ctx.dbUser.id, parseInt(ctx.match[2], 10), accept);
      await ctx.answerCallbackQuery(alreadyDecided ? (en ? 'Already answered' : 'Вже вирішено') : accept ? (en ? 'Friends now' : 'Тепер ви друзі') : (en ? 'Declined' : 'Відхилено'));
      const outcome = status === 'accepted' ? (en ? 'You are friends now.' : 'Тепер ви друзі.') : (en ? 'Declined.' : 'Відхилено.');
      await ctx.editMessageText(`${escapeHtml(ctx.callbackQuery.message?.text ?? '')}\n\n${outcome}`, { parse_mode: 'HTML' });
    } catch (err: any) {
      await ctx.answerCallbackQuery(err?.message ?? (en ? 'Something went wrong' : 'Не вийшло'));
    }
  });

  // "Не отримувати від Олега" under a friend's reminder
  bot.callbackQuery(/^mute:(\d+)$/, async (ctx) => {
    const en = ctx.dbUser.languagePref === 'en';
    await ReminderService.mute(ctx.dbUser.id, parseInt(ctx.match[1], 10));
    await ctx.answerCallbackQuery(en ? 'No more reminders from them' : 'Більше не надсилатимемо');
    await ctx.editMessageReplyMarkup({ reply_markup: undefined }).catch(() => {});
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

  // "Продовжити на 30 хв" under the "ends soon" reminder
  bot.callbackQuery(/^book:e:(\d+)$/, async (ctx) => {
    const en = ctx.dbUser.languagePref === 'en';
    try {
      const { endTime } = await BookingService.extend(parseInt(ctx.match[1], 10), ctx.dbUser.id);
      const until = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Kyiv', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(endTime);
      await ctx.answerCallbackQuery(en ? `Extended until ${until}` : `Продовжено до ${until}`);
      await ctx.editMessageText(`${escapeHtml(ctx.callbackQuery.message?.text ?? '')}\n\n${en ? `Extended until ${until}.` : `Продовжено до ${until}.`}`, { parse_mode: 'HTML' });
    } catch (err: any) {
      await ctx.answerCallbackQuery({ text: err?.message ?? (en ? "Couldn't extend" : 'Не вийшло продовжити'), show_alert: true });
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
    .replace(/^[ \t]*[-*•][ \t]+/gm, '') // list markers go first ("* item" isn't italics); lines read as a list on their own
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
