import OpenAI from 'openai';
import { BookingService } from '../services/bookingService.js';
import { MoodleService } from '../services/moodleService.js';
import { db } from '../db/connection.js';
import { opportunities } from '../db/schema.js';
import { eq, ilike, and, gte } from 'drizzle-orm';
import { toolDefinitions } from './tools.js';

const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY,
});

const SYSTEM_PROMPT_EN = `You are KSE Copilot — an AI campus assistant for Kyiv School of Economics students.
You help students with:
1. Room bookings (Skype Rooms & Silent Boxes). Max 3h/day per student.
2. Moodle deadlines — upcoming assignments and quizzes.
3. Career opportunities — internships, jobs, grants.

Rules:
- Be concise and helpful. Use markdown formatting.
- When booking rooms, always check availability first.
- When searching opportunities, consider the student's eligibility (grant/contract).
- Reply in the same language the student uses (Ukrainian or English).
- Always confirm actions before executing them.`;

const SYSTEM_PROMPT_UK = `Ти — KSE Copilot, AI-помічник кампусу Київської школи економіки.
Ти допомагаєш студентам з:
1. Бронюванням кімнат (Skype Rooms і Silent Boxes). Максимум 3 год/день.
2. Дедлайнами Moodle — завдання та тести.
3. Кар'єрними можливостями — стажування, робота, гранти.

Правила:
- Будь коротким і корисним. Використовуй markdown.
- При бронюванні — завжди перевіряй доступність.
- При пошуку можливостей — враховуй тип студента (грант/контракт).
- Відповідай тією мовою, якою пише студент.
- Завжди підтверджуй дії перед виконанням.`;

export class AIService {
  /**
   * Process a chat message with OpenAI function calling.
   */
  static async chat(
    userId: number,
    message: string,
    lang: string = 'uk',
    conversationHistory: OpenAI.ChatCompletionMessageParam[] = []
  ) {
    const systemPrompt = lang === 'uk' ? SYSTEM_PROMPT_UK : SYSTEM_PROMPT_EN;

    const messages: OpenAI.ChatCompletionMessageParam[] = [
      { role: 'system', content: systemPrompt },
      ...conversationHistory,
      { role: 'user', content: message },
    ];

    const response = await openai.chat.completions.create({
      model: 'gpt-4o',
      messages,
      tools: toolDefinitions,
      tool_choice: 'auto',
      temperature: 0.7,
      max_tokens: 1000,
    });

    const assistantMessage = response.choices[0].message;

    // Handle tool calls
    if (assistantMessage.tool_calls && assistantMessage.tool_calls.length > 0) {
      const toolResults: OpenAI.ChatCompletionMessageParam[] = [
        assistantMessage as OpenAI.ChatCompletionMessageParam,
      ];

      for (const toolCall of assistantMessage.tool_calls) {
        const result = await this.executeTool(
          toolCall.function.name,
          JSON.parse(toolCall.function.arguments),
          userId
        );

        toolResults.push({
          role: 'tool',
          tool_call_id: toolCall.id,
          content: JSON.stringify(result),
        });
      }

      // Get final response after tool execution
      const finalResponse = await openai.chat.completions.create({
        model: 'gpt-4o',
        messages: [...messages, ...toolResults],
        temperature: 0.7,
        max_tokens: 1000,
      });

      return {
        content: finalResponse.choices[0].message.content,
        toolCalls: assistantMessage.tool_calls.map((tc) => ({
          name: tc.function.name,
          args: JSON.parse(tc.function.arguments),
        })),
      };
    }

    return {
      content: assistantMessage.content,
      toolCalls: [],
    };
  }

  /**
   * Execute a tool call.
   */
  private static async executeTool(
    name: string,
    args: Record<string, any>,
    userId: number
  ): Promise<any> {
    switch (name) {
      case 'get_available_rooms': {
        const startTime = args.start_time
          ? new Date(args.start_time)
          : new Date();
        const endTime = args.end_time
          ? new Date(args.end_time)
          : new Date(startTime.getTime() + 60 * 60 * 1000);
        return BookingService.getAvailableRooms(startTime, endTime, args.room_type);
      }

      case 'book_room': {
        try {
          const result = await BookingService.createBooking(
            userId,
            args.room_id,
            new Date(args.start_time),
            new Date(args.end_time)
          );
          return { success: true, booking: result.booking, room: result.room };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      }

      case 'hot_book_room': {
        try {
          const result = await BookingService.hotBook(userId, args.room_id);
          return { success: true, booking: result.booking, room: result.room };
        } catch (err: any) {
          return { success: false, error: err.message };
        }
      }

      case 'get_my_deadlines': {
        return MoodleService.getDeadlines(userId, args.include_completed);
      }

      case 'get_booking_quota': {
        return BookingService.getRemainingQuota(userId);
      }

      case 'search_opportunities': {
        const conditions = [gte(opportunities.deadline, new Date())];
        if (args.eligibility) {
          conditions.push(eq(opportunities.eligibility, args.eligibility));
        }
        if (args.domain) {
          conditions.push(ilike(opportunities.domain, `%${args.domain}%`));
        }

        return db
          .select()
          .from(opportunities)
          .where(and(...conditions))
          .limit(10);
      }

      case 'get_my_bookings': {
        return BookingService.getUserBookings(userId);
      }

      default:
        return { error: `Unknown tool: ${name}` };
    }
  }
}
