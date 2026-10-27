import { Hono } from 'hono';
import { AIService, AILimitError } from '../ai/aiService.js';
import { chatMessageSchema } from '../utils/validators.js';
import { AppError } from '../middleware/errorHandler.js';

const copilotRoutes = new Hono();

// POST /copilot/chat — Send message to AI
copilotRoutes.post('/chat', async (c) => {
  const user = c.get('dbUser');
  if (!user.onboardedAt) throw new AppError('Спершу заверши реєстрацію в KSE Hub', 403);
  const body = await c.req.json();
  const { message } = chatMessageSchema.parse(body);

  try {
    return c.json(await AIService.chat(user.id, message, 'app'));
  } catch (err) {
    if (err instanceof AILimitError) throw err;
    console.error('Assistant failed:', err);
    throw new AppError('Copilot зараз перевантажений. Спробуй за хвилину.', 503);
  }
});

// DELETE /copilot/history — Start a new conversation
copilotRoutes.delete('/history', async (c) => {
  await AIService.clearHistory(c.get('dbUser').id);
  return c.json({ success: true });
});

export { copilotRoutes };
