import { Hono } from 'hono';
import { AIService } from '../ai/aiService.js';
import { chatMessageSchema } from '../utils/validators.js';

const copilotRoutes = new Hono();

// POST /copilot/chat — Send message to AI
copilotRoutes.post('/chat', async (c) => {
  const user = c.get('dbUser');
  const body = await c.req.json();
  const { message } = chatMessageSchema.parse(body);

  const response = await AIService.chat(
    user.id,
    message,
    user.languagePref || 'uk'
  );

  return c.json(response);
});

export { copilotRoutes };
