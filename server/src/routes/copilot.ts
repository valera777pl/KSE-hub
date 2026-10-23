import { Hono } from 'hono';
import { AIService } from '../ai/aiService.js';
import { chatMessageSchema } from '../utils/validators.js';

const copilotRoutes = new Hono();

// POST /copilot/chat — Send message to AI
copilotRoutes.post('/chat', async (c) => {
  const user = c.get('dbUser');
  const body = await c.req.json();
  const { message } = chatMessageSchema.parse(body);

  const response = await AIService.chat(user.id, message);
  return c.json(response);
});

// DELETE /copilot/history — Start a new conversation
copilotRoutes.delete('/history', async (c) => {
  await AIService.clearHistory(c.get('dbUser').id);
  return c.json({ success: true });
});

export { copilotRoutes };
