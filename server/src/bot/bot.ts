import { Bot, Context, InlineKeyboard } from 'grammy';
import { db } from '../db/connection.js';
import { users, type DigestSource } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { upsertUser } from '../middleware/telegramAuth.js';
import { DigestService, SOURCE_LABELS } from '../services/digestService.js';
import { GoogleService } from '../services/googleService.js';
import { appUrl, chunkHtml, escapeHtml, openAppKeyboard } from './send.js';
import { formatKyiv, timeLeft } from '../utils/kyivTime.js';

type DbUser = typeof users.$inferSelect;
type BotContext = Context & { dbUser: DbUser };

const DIGEST_HOURS = [8, 13, 20];
const ALL_SOURCES: DigestSource[] = ['moodle', 'gmail', 'slack'];

export const BOT_COMMANDS = [
  { command: 'start', description: 'Відкрити KSE Hub' },
  { command: 'deadlines', description: 'Дедлайни на тиждень' },
  { command: 'digest', description: 'Дайджест зараз' },
  { command: 'settings', description: 'Що і коли надсилати' },
  { command: 'connect_google', description: 'Підключити пошту @kse.org.ua' },
  { command: 'help', description: 'Що вміє бот' },
  { command: 'delete_my_data', description: 'Видалити мої дані' },
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
    await ctx.reply(
      `Привіт, ${name}! 👋\n\n` +
        `Я <b>KSE Hub</b> — збираю Moodle, пошту та Slack в одному місці.\n\n` +
        `• Нагадаю про дедлайни за 24 год і за 3 год\n` +
        `• Щодня надсилатиму дайджест з обраних джерел\n` +
        `• У міні-застосунку — розклад, стажування, стартапи та ІІ-асистент\n\n` +
        `Почни з міні-застосунку, а що надсилати — обери в /settings.`,
      { parse_mode: 'HTML', reply_markup: openAppKeyboard() }
    );
  });

  bot.command('help', async (ctx) => {
    await ctx.reply(
      BOT_COMMANDS.map((c) => `/${c.command} — ${c.description}`).join('\n'),
      { reply_markup: openAppKeyboard() }
    );
  });

  bot.command('deadlines', async (ctx) => {
    const now = new Date();
    const rows = await DigestService.upcomingDeadlines(ctx.dbUser.id, now, new Date(now.getTime() + 7 * 24 * 3_600_000));

    if (rows.length === 0) {
      const hint = ctx.dbUser.calendarUrl
        ? 'На найближчий тиждень дедлайнів немає 🎉'
        : 'Moodle ще не підключено. Відкрий KSE Hub → Moodle і встав посилання на календар.';
      await ctx.reply(hint, { reply_markup: openAppKeyboard() });
      return;
    }

    const lines = rows.map(({ assignment, courseName }) => {
      const due = assignment.dueDate!;
      const course = courseName ? `\n  <i>${escapeHtml(courseName)}</i>` : '';
      return `• <b>${escapeHtml(assignment.title)}</b>${course}\n  ⏰ ${formatKyiv(due)} (${timeLeft(due, now)})`;
    });
    for (const chunk of chunkHtml(`📚 <b>Дедлайни на тиждень</b>\n\n${lines.join('\n\n')}`)) {
      await ctx.reply(chunk, { parse_mode: 'HTML' });
    }
  });

  bot.command('digest', async (ctx) => {
    const text = await DigestService.build(ctx.dbUser);
    for (const chunk of chunkHtml(text ?? 'Поки нічого нового в обраних джерелах ✨')) {
      await ctx.reply(chunk, { parse_mode: 'HTML', link_preview_options: { is_disabled: true } });
    }
  });

  bot.command('settings', async (ctx) => {
    await ctx.reply(settingsText(ctx.dbUser), { parse_mode: 'HTML', reply_markup: settingsKeyboard(ctx.dbUser) });
  });

  bot.callbackQuery(/^src:(moodle|gmail|slack)$/, async (ctx) => {
    const source = ctx.match[1] as DigestSource;
    const current = ctx.dbUser.digestSources;
    const next = current.includes(source) ? current.filter((s) => s !== source) : [...current, source];
    // Keep the canonical order so the digest sections are always the same
    const digestSources = ALL_SOURCES.filter((s) => next.includes(s));
    await updateSettings(ctx, { digestSources });
  });

  bot.callbackQuery(/^hour:(-1|\d{1,2})$/, async (ctx) => {
    await updateSettings(ctx, { digestHour: parseInt(ctx.match[1], 10) });
  });

  bot.command('connect_google', async (ctx) => {
    const account = await GoogleService.getAccount(ctx.dbUser.id);
    const status = account
      ? account.syncError === 'invalid_grant'
        ? `⚠️ Доступ до <b>${escapeHtml(account.email)}</b> відкликано — підключи знову.`
        : `Зараз підключено <b>${escapeHtml(account.email)}</b>. Можна перепідключити або змінити акаунт.`
      : 'Підключи корпоративну пошту, щоб отримувати короткий зміст листів у дайджесті.';
    await ctx.reply(
      `${status}

Ми бачимо лише листи (тільки читання) і календар. Відключити — /delete_my_data.`,
      { parse_mode: 'HTML', reply_markup: new InlineKeyboard().url('📧 Підключити @kse.org.ua', GoogleService.authUrl(ctx.dbUser.id)) }
    );
  });

  bot.command('delete_my_data', async (ctx) => {
    await ctx.reply(
      'Видалити всі твої дані з KSE Hub? Це прибере підключення Moodle і пошти, листи, дедлайни, профіль VentureMatch і бронювання. Скасувати не можна.',
      { reply_markup: new InlineKeyboard().text('🗑 Так, видалити', 'delete:yes').text('Скасувати', 'delete:no') }
    );
  });

  bot.callbackQuery('delete:yes', async (ctx) => {
    await GoogleService.disconnect(ctx.dbUser.id).catch(() => {});
    await db.delete(users).where(eq(users.id, ctx.dbUser.id));
    await ctx.answerCallbackQuery();
    await ctx.editMessageText('Готово, твої дані видалено. Натисни /start, якщо захочеш повернутися.');
  });

  bot.callbackQuery('delete:no', async (ctx) => {
    await ctx.answerCallbackQuery();
    await ctx.editMessageText('Скасовано 👌');
  });

  bot.on('message', async (ctx) => {
    await ctx.reply('Поки я розумію лише команди — спробуй /help. Чат з ІІ-асистентом скоро буде тут.', {
      reply_markup: openAppKeyboard(),
    });
  });

  return bot;
}

async function updateSettings(ctx: BotContext, patch: Partial<Pick<DbUser, 'digestSources' | 'digestHour'>>) {
  const [updated] = await db
    .update(users)
    .set({ ...patch, updatedAt: new Date() })
    .where(eq(users.id, ctx.dbUser.id))
    .returning();
  await ctx.answerCallbackQuery('Збережено');
  await ctx.editMessageText(settingsText(updated), { parse_mode: 'HTML', reply_markup: settingsKeyboard(updated) });
}

function settingsText(user: DbUser): string {
  const sources = user.digestSources.length
    ? user.digestSources.map((s) => SOURCE_LABELS[s]).join(', ')
    : 'нічого';
  const when = user.digestHour < 0 ? 'вимкнено' : `щодня о ${String(user.digestHour).padStart(2, '0')}:00`;
  return (
    `⚙️ <b>Налаштування дайджесту</b>\n\n` +
    `Джерела: ${sources}\nКоли: ${when}\n\n` +
    `Нагадування про дедлайни приходять завжди, коли увімкнено Moodle.`
  );
}

function settingsKeyboard(user: DbUser): InlineKeyboard {
  const kb = new InlineKeyboard();
  for (const source of ALL_SOURCES) {
    const on = user.digestSources.includes(source);
    kb.text(`${on ? '✅' : '⬜️'} ${SOURCE_LABELS[source]}`, `src:${source}`);
  }
  kb.row();
  for (const hour of DIGEST_HOURS) {
    kb.text(`${user.digestHour === hour ? '🔘' : ''}${String(hour).padStart(2, '0')}:00`, `hour:${hour}`);
  }
  kb.text(`${user.digestHour < 0 ? '🔘' : ''}Вимкнути`, 'hour:-1');
  kb.row().webApp('🎓 Відкрити KSE Hub', appUrl());
  return kb;
}
