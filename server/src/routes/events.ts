import { Hono } from 'hono';
import { EventService } from '../services/eventService.js';
import { AppError } from '../middleware/errorHandler.js';

const eventRoutes = new Hono();

const idParam = (value: string) => {
  const id = parseInt(value, 10);
  if (!Number.isSafeInteger(id)) throw new AppError('Bad id', 400);
  return id;
};

// GET /events — upcoming, mass mailings plus my personal invites
eventRoutes.get('/', async (c) => c.json({ events: await EventService.upcoming(c.get('dbUser').id) }));

// GET /events/:id — one event (deep link event_<id>)
eventRoutes.get('/:id', async (c) => c.json({ event: await EventService.get(c.get('dbUser').id, idParam(c.req.param('id'))) }));

// POST /events/:id/remind — «Нагадати за день»; DELETE to cancel
eventRoutes.post('/:id/remind', async (c) => c.json(await EventService.remind(c.get('dbUser').id, idParam(c.req.param('id')))));
eventRoutes.delete('/:id/remind', async (c) => c.json(await EventService.unremind(c.get('dbUser').id, idParam(c.req.param('id')))));

export { eventRoutes };
