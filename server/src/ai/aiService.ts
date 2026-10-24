import type OpenAI from 'openai';
import { BookingService } from '../services/bookingService.js';
import { MoodleService } from '../services/moodleService.js';
import { ScheduleService, type ScheduleEvent } from '../services/scheduleService.js';
import { KnowledgeService } from '../services/knowledgeService.js';
import { GmailService } from '../services/gmailService.js';
import { DigestService } from '../services/digestService.js';
import { db } from '../db/connection.js';
import { chatMessages, emails, opportunities, summaries } from '../db/schema.js';
import { and, desc, eq, gt, gte, ilike, isNull, or } from 'drizzle-orm';
import { toolDefinitions } from './tools.js';
import { chatCompletion } from './client.js';
import { AnalyticsService } from '../services/analyticsService.js';
import { AppError } from '../middleware/errorHandler.js';
import { users } from '../db/schema.js';
import { formatKyiv, kyivDate, kyivDayStart, kyivNowForPrompt } from '../utils/kyivTime.js';

const HISTORY_TURNS = 10;
// Free Gemini quota is shared by everyone; a paid plan can lift this later
const DAILY_LIMIT = parseInt(process.env.AI_DAILY_LIMIT || '30', 10);

export class AILimitError extends AppError {
  constructor() {
    super(`Ліміт ${DAILY_LIMIT} повідомлень ІІ на сьогодні вичерпано. Завтра знову можна 🙂`, 429);
  }
}
const MAX_TOOL_ROUNDS = 3;

function systemPrompt(): string {
  return `Ти — KSE Hub, ІІ-помічник студентів Київської школи економіки (KSE).
Зараз у Києві: ${kyivNowForPrompt()}. «Завтра», «у понеділок» тощо рахуй від цієї дати.

Ти допомагаєш з:
1. Бронюванням кімнат — Skype Rooms і Silent Boxes, максимум 3 год на день.
2. Розкладом пар — свій розклад, спільні пари з іншими студентами, хто з одногрупників вільний.
3. Дедлайнами Moodle — завдання та тести студента.
4. Листами — короткий зміст пошти @kse.org.ua, сповіщень Slack і Moodle.
5. Стажуваннями, вакансіями та грантами.
6. Інформацією про KSE — програми, гранти й фінансова допомога, оплата, обмін, викладачі, контакти, кампус.

Правила:
- Відповідай коротко, тією мовою, якою пише студент (за замовчуванням українською).
- Форматування: лише **жирний**, *курсив*, \`код\`, [посилання](url) і списки з "• ". Без таблиць і заголовків.
- Дані про студента бери тільки з інструментів. Нічого не вигадуй: якщо даних немає — так і скажи.
- Бронювання: спершу перевір вільні кімнати (get_available_rooms), запропонуй варіант і бронюй лише після згоди студента. Час — за Києвом, передавай у ISO 8601 з київським поясом з рядка «Зараз».
- Якщо інструмент повернув "error" — дія НЕ виконана. Скажи студенту, що саме не вийшло, і не пиши, що все готово.
- Про KSE (програми, гранти, оплата, обмін, викладачі, контакти) спершу шукай через search_kse_info і відповідай лише з того, що знайшов, додаючи посилання на сторінку-джерело (якщо url немає — це внутрішня інформація KSE, назви джерело без посилання). Давай конкретні контакти (імʼя, пошта), якщо вони є. Якщо контакт стосується лише однієї програми — так і скажи. Якщо нічого не знайдено — так і скажи й порадь звернутися до Student Office або приймальної комісії; не вигадуй.`;
}

export class AIService {
  /**
   * One assistant turn. The conversation is kept in chat_messages,
   * so the bot chat and the mini app continue the same dialogue.
   */
  static async chat(userId: number, message: string, source: 'bot' | 'app' = 'app') {
    const [user] = await db.select({ isAdmin: users.isAdmin }).from(users).where(eq(users.id, userId)).limit(1);
    if (!user?.isAdmin && (await AnalyticsService.countToday(userId, 'ai.message')) >= DAILY_LIMIT) {
      AnalyticsService.track(userId, 'ai.limit_hit', { source });
      throw new AILimitError();
    }

    const history = await this.history(userId);
    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt() },
      ...history,
      { role: 'user', content: message },
    ];
    const toolCalls: { name: string; args: unknown }[] = [];

    let reply: string | null = null;
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const response = await chatCompletion({
        messages,
        // Last round: no tools, force a text answer
        ...(round < MAX_TOOL_ROUNDS ? { tools: toolDefinitions, tool_choice: 'auto' as const } : {}),
        temperature: 0.4,
        max_tokens: 1000,
      });
      const assistantMessage = response.choices[0]?.message;
      if (!assistantMessage?.tool_calls?.length) {
        reply = assistantMessage?.content ?? null;
        break;
      }

      // Passed back as returned: Gemini needs its thought signatures on tool-call turns
      messages.push(assistantMessage as OpenAI.ChatCompletionMessageParam);
      for (const call of assistantMessage.tool_calls) {
        const args = safeJson(call.function.arguments);
        toolCalls.push({ name: call.function.name, args });
        AnalyticsService.track(userId, 'ai.tool', { name: call.function.name });
        const result = await this.executeTool(call.function.name, args, userId).catch((err) => ({ error: String(err?.message ?? err) }));
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
      }
    }

    const content = reply?.trim() || 'Не вдалося сформулювати відповідь, спробуй перепитати.';
    AnalyticsService.track(userId, 'ai.message', { source });
    await db.insert(chatMessages).values([
      { userId, role: 'user', content: message },
      { userId, role: 'assistant', content },
    ]);
    return { content, toolCalls };
  }

  static async clearHistory(userId: number) {
    await db.delete(chatMessages).where(eq(chatMessages.userId, userId));
  }

  private static async history(userId: number): Promise<OpenAI.ChatCompletionMessageParam[]> {
    const rows = await db
      .select({ role: chatMessages.role, content: chatMessages.content })
      .from(chatMessages)
      .where(eq(chatMessages.userId, userId))
      .orderBy(desc(chatMessages.createdAt), desc(chatMessages.id))
      .limit(HISTORY_TURNS * 2);
    return rows.reverse();
  }

  private static async executeTool(name: string, args: Record<string, any>, userId: number): Promise<unknown> {
    switch (name) {
      case 'get_available_rooms': {
        const start = args.start_time ? new Date(args.start_time) : new Date();
        const end = args.end_time ? new Date(args.end_time) : new Date(start.getTime() + 60 * 60 * 1000);
        return BookingService.getAvailableRooms(start, end, args.room_type);
      }

      case 'book_room': {
        const result = await BookingService.createBooking(userId, args.room_id, new Date(args.start_time), new Date(args.end_time));
        AnalyticsService.track(userId, 'booking.created', { via: 'ai' });
        return { success: true, room: result.room.name, from: formatKyiv(new Date(args.start_time)), to: formatKyiv(new Date(args.end_time)) };
      }

      case 'hot_book_room': {
        const { booking, room } = await BookingService.hotBook(userId, args.room_id);
        AnalyticsService.track(userId, 'booking.created', { via: 'ai', hot: true });
        return { success: true, room: room.name, from: formatKyiv(new Date(booking.start_time)), to: formatKyiv(new Date(booking.end_time)) };
      }

      case 'get_booking_quota':
        return BookingService.getRemainingQuota(userId);

      case 'get_my_bookings': {
        // Kyiv times only, so the model doesn't echo UTC back to the student
        const rows = await BookingService.getUserBookings(userId);
        return rows.map(({ booking, room }) => ({
          room: room?.name, from: formatKyiv(booking.startTime), to: formatKyiv(booking.endTime), status: booking.status,
        }));
      }

      case 'search_kse_info': {
        const found = await KnowledgeService.search(String(args.query ?? ''), 5);
        return found.length
          // "doc:…" entries are internal KSE documents without a public page
          ? found.map((f) => ({ source: f.title, url: f.url.startsWith('http') ? f.url : null, text: f.content }))
          : { note: 'У базі знань KSE нічого не знайдено.' };
      }

      case 'get_my_schedule': {
        const fromDay = /^\d{4}-\d{2}-\d{2}$/.test(args.from_date ?? '') ? args.from_date : kyivDate();
        const days = Math.min(Math.max(Number(args.days) || 1, 1), 14);
        const start = kyivDayStart(fromDay);
        const events = await ScheduleService.events(userId, start, new Date(start.getTime() + days * 86_400_000));
        return events.length ? events.map(describeClass) : { note: 'Пар немає (або пошту ще не підключено в KSE Hub).' };
      }

      case 'compare_schedule': {
        let otherId = Number(args.user_id) || null;
        if (!otherId) {
          const found = await ScheduleService.searchStudents(String(args.student ?? ''), userId);
          if (found.length === 0) return { error: 'Студента не знайдено: можливо, він ще не підключив пошту в KSE Hub або приховав розклад.' };
          if (found.length > 1) return { ambiguous: found.map((s) => ({ user_id: s.userId, name: s.name, cohort: s.cohort, telegram: s.username })) };
          otherId = found[0].userId;
        }
        const week = /^\d{4}-\d{2}-\d{2}$/.test(args.week_of ?? '') ? args.week_of : new Date();
        const result = await ScheduleService.compare(userId, otherId, week);
        return {
          student: result.student,
          shared_courses: result.sharedCourses,
          classes: result.events.map((e) => ({ ...describeClass(e), shared: e.shared })),
        };
      }

      case 'find_free_classmates': {
        const free = await ScheduleService.freeClassmates(userId, new Date(args.start_time), new Date(args.end_time));
        return free.length ? free.map((s) => ({ name: s.name, cohort: s.cohort, telegram: s.username })) : { note: 'Нікого вільного серед одногрупників у KSE Hub.' };
      }

      case 'get_my_deadlines': {
        if (args.include_completed) return MoodleService.getDeadlines(userId, true);
        const days = Math.min(Math.max(Number(args.days) || 14, 1), 90);
        const now = new Date();
        const rows = await DigestService.upcomingDeadlines(userId, now, new Date(now.getTime() + days * 86_400_000), 30);
        return rows.map(({ assignment, courseName }) => ({
          title: assignment.title,
          course: courseName,
          due: assignment.dueDate ? formatKyiv(assignment.dueDate) : null,
          type: assignment.type,
          url: assignment.sourceUrl,
        }));
      }

      case 'search_my_emails': {
        // The cron pulls mail every ~10 min; when the student asks, look for brand-new letters first
        await GmailService.syncIfStale(userId);
        const conditions = [
          eq(emails.userId, userId),
          gt(emails.receivedAt, new Date(Date.now() - 30 * 86_400_000)),
        ];
        if (args.source) conditions.push(eq(emails.source, args.source));
        if (args.query) {
          const like = `%${String(args.query)}%`;
          conditions.push(or(ilike(emails.subject, like), ilike(summaries.summary, like))!);
        }
        const rows = await db
          .select({
            subject: emails.subject, from: emails.fromName, source: emails.source,
            receivedAt: emails.receivedAt, summary: summaries.summary, category: summaries.category,
          })
          .from(emails)
          .innerJoin(summaries, eq(emails.summaryId, summaries.id))
          .where(and(...conditions))
          .orderBy(desc(emails.receivedAt))
          .limit(15);
        return rows.length
          ? rows.map((r) => ({ ...r, receivedAt: formatKyiv(r.receivedAt) }))
          : { note: 'Нічого не знайдено. Можливо, пошта ще не підключена в міні-застосунку.' };
      }

      case 'search_opportunities': {
        // Opportunities collected from emails usually have no explicit deadline
        const conditions = [or(isNull(opportunities.deadline), gte(opportunities.deadline, new Date()))!];
        if (args.eligibility) conditions.push(eq(opportunities.eligibility, args.eligibility));
        if (args.domain) conditions.push(ilike(opportunities.domain, `%${args.domain}%`));
        return db.select().from(opportunities).where(and(...conditions)).orderBy(desc(opportunities.createdAt)).limit(10);
      }

      default:
        return { error: `Unknown tool: ${name}` };
    }
  }
}

function describeClass(e: ScheduleEvent) {
  return {
    course: `${e.courseCode} [${e.section}]`,
    title: e.title,
    from: formatKyiv(e.startAt),
    to: formatKyiv(e.endAt),
    where: e.location,
  };
}

function safeJson(text: string): Record<string, any> {
  try {
    return JSON.parse(text || '{}');
  } catch {
    return {};
  }
}
