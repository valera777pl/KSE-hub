import type OpenAI from 'openai';
import { MoodleService } from '../services/moodleService.js';
import { DigestService } from '../services/digestService.js';
import { db } from '../db/connection.js';
import { chatMessages, emails, opportunities, summaries } from '../db/schema.js';
import { and, desc, eq, gt, gte, ilike, isNull, or } from 'drizzle-orm';
import { toolDefinitions } from './tools.js';
import { chatCompletion } from './client.js';
import { formatKyiv } from '../utils/kyivTime.js';

const HISTORY_TURNS = 10;
const MAX_TOOL_ROUNDS = 3;

function systemPrompt(): string {
  return `Ти — KSE Hub, ІІ-помічник студентів Київської школи економіки (KSE).
Зараз: ${formatKyiv(new Date())} (Київ).

Ти допомагаєш з:
1. Дедлайнами Moodle — завдання та тести студента.
2. Листами — короткий зміст пошти @kse.org.ua, сповіщень Slack і Moodle.
3. Стажуваннями, вакансіями та грантами.

Правила:
- Відповідай коротко, тією мовою, якою пише студент (за замовчуванням українською).
- Форматування: лише **жирний**, *курсив*, \`код\`, [посилання](url) і списки з "• ". Без таблиць і заголовків.
- Дані про студента бери тільки з інструментів. Нічого не вигадуй: якщо даних немає — так і скажи.
- Бронювання кімнат: ти не бронюєш сам. Скажи, що це робиться через бота BookingRooms у Slack KSE (кнопки Book time / Book room / Hot Booking), максимум 3 год на день.
- Про правила, програми й процедури KSE відповідай лише тим, у чому впевнений; інакше порадь звернутися до Student Office або на kse.ua.`;
}

export class AIService {
  /**
   * One assistant turn. The conversation is kept in chat_messages,
   * so the bot chat and the mini app continue the same dialogue.
   */
  static async chat(userId: number, message: string) {
    const history = await this.history(userId);
    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt() },
      ...history,
      { role: 'user', content: message },
    ];
    const toolCalls: { name: string; args: unknown }[] = [];

    let reply: string | null = null;
    for (let round = 0; round <= MAX_TOOL_ROUNDS; round++) {
      const response = await chatCompletion('assistant', {
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
        const result = await this.executeTool(call.function.name, args, userId).catch((err) => ({ error: String(err?.message ?? err) }));
        messages.push({ role: 'tool', tool_call_id: call.id, content: JSON.stringify(result) });
      }
    }

    const content = reply?.trim() || 'Не вдалося сформулювати відповідь, спробуй перепитати.';
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

function safeJson(text: string): Record<string, any> {
  try {
    return JSON.parse(text || '{}');
  } catch {
    return {};
  }
}
