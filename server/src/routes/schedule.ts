import { Hono } from 'hono';
import { ScheduleService } from '../services/scheduleService.js';
import { GoogleService } from '../services/googleService.js';
import { AppError } from '../middleware/errorHandler.js';

const scheduleRoutes = new Hono();

const weekParam = (value: string | undefined) => (value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : new Date());

// GET /schedule/week?start=YYYY-MM-DD — my classes in that week (Mon–Sun, Kyiv)
scheduleRoutes.get('/week', async (c) => {
  const user = c.get('dbUser');
  const connected = !!(await GoogleService.getAccount(user.id));
  const events = connected ? await ScheduleService.weekEvents(user.id, weekParam(c.req.query('start'))) : [];
  return c.json({ connected, events });
});

// GET /schedule/search?q=петренко — students with a visible schedule
scheduleRoutes.get('/search', async (c) => {
  const students = await ScheduleService.searchStudents(c.req.query('q') ?? '', c.get('dbUser').id);
  return c.json({ students });
});

// GET /schedule/compare/:userId?start=YYYY-MM-DD — their week, shared classes marked
scheduleRoutes.get('/compare/:userId', async (c) => {
  const otherId = parseInt(c.req.param('userId'), 10);
  if (!Number.isFinite(otherId)) throw new AppError('Bad user id', 400);
  return c.json(await ScheduleService.compare(c.get('dbUser').id, otherId, weekParam(c.req.query('start'))));
});

export { scheduleRoutes };
