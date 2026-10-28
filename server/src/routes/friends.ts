import { Hono } from 'hono';
import { FriendService } from '../services/friendService.js';
import { AppError } from '../middleware/errorHandler.js';

const friendRoutes = new Hono();

const idParam = (value: string) => {
  const id = parseInt(value, 10);
  if (!Number.isSafeInteger(id)) throw new AppError('Bad id', 400);
  return id;
};

// GET /friends — { friends, incoming, outgoing }
friendRoutes.get('/', async (c) => c.json(await FriendService.list(c.get('dbUser').id)));

// GET /friends/invite — the t.me link that makes whoever joins through it my friend
friendRoutes.get('/invite', async (c) => c.json({ link: await FriendService.inviteLink(c.get('dbUser').id) }));

// POST /friends/request { userId } — they get «Прийняти / Відхилити» in the bot
friendRoutes.post('/request', async (c) => {
  const { userId } = await c.req.json().catch(() => ({}));
  return c.json(await FriendService.request(c.get('dbUser').id, idParam(String(userId))));
});

// POST /friends/import { userIds } — friends picked for comparison on this phone, once
friendRoutes.post('/import', async (c) => {
  const { userIds } = await c.req.json().catch(() => ({}));
  const ids = Array.isArray(userIds) ? userIds.map(Number) : [];
  return c.json({ results: await FriendService.importFromPhone(c.get('dbUser').id, ids) });
});

// POST /friends/:friendshipId/accept | /decline
friendRoutes.post('/:id/:answer{accept|decline}', async (c) => {
  const result = await FriendService.respond(c.get('dbUser').id, idParam(c.req.param('id')), c.req.param('answer') === 'accept');
  return c.json(result);
});

// DELETE /friends/:userId — no longer friends
friendRoutes.delete('/:userId', async (c) => {
  await FriendService.remove(c.get('dbUser').id, idParam(c.req.param('userId')));
  return c.json({ ok: true });
});

export { friendRoutes };
