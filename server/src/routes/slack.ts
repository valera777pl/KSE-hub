import { Hono } from 'hono';
import { z } from 'zod';
import { hasBearer } from './bot.js';
import { SlackService } from '../services/slackService.js';
import { ingestSchema } from '../utils/slackIngest.js';

/*
 * Slack digests through the reader account (SLACK-DIGEST-PROMPT.md).
 * Claude's scheduled task: its own secret, no Telegram initData. Mounted before the /api auth.
 */
const slackTaskRoutes = new Hono();

// GET /api/slack/cursors — where each channel's last run ended
slackTaskRoutes.get('/cursors', async (c) => {
  if (!hasBearer(c, process.env.SLACK_INGEST_SECRET)) return c.json({ error: 'Unauthorized' }, 401);
  return c.json(await SlackService.cursors());
});

// POST /api/slack/ingest — the task's summaries; they land as drafts unless the channel auto-publishes
slackTaskRoutes.post('/ingest', async (c) => {
  if (!hasBearer(c, process.env.SLACK_INGEST_SECRET)) return c.json({ error: 'Unauthorized' }, 401);
  const { channels } = ingestSchema.parse(await c.req.json());
  return c.json({ ok: true, ...(await SlackService.ingest(channels)) });
});

/* The student, behind Telegram auth: only channels that pass canSee */
const slackRoutes = new Hono();

const subscriptionsSchema = z.object({
  slots: z.array(z.enum(['morning', 'evening'])).min(1).max(2)
    .transform((s) => (['morning', 'evening'] as const).filter((x) => s.includes(x))).optional(),
  channels: z.array(z.object({ channelId: z.string().max(20), on: z.boolean() })).max(100).optional(),
});

// GET /slack/feed — published summaries from my channels and the open ones
slackRoutes.get('/feed', async (c) => c.json(await SlackService.feed(c.get('dbUser').id)));

// GET /slack/subscriptions — my channels with on/off and the digest time; PUT to change
slackRoutes.get('/subscriptions', async (c) => c.json(await SlackService.subscriptions(c.get('dbUser').id)));
slackRoutes.put('/subscriptions', async (c) => {
  const body = subscriptionsSchema.parse(await c.req.json());
  return c.json(await SlackService.updateSubscriptions(c.get('dbUser').id, body));
});

export { slackRoutes, slackTaskRoutes };
