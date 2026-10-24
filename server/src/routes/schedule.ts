import { Hono } from 'hono';
import { ScheduleService } from '../services/scheduleService.js';
import { GoogleService } from '../services/googleService.js';
import { AppError } from '../middleware/errorHandler.js';
import { AnalyticsService } from '../services/analyticsService.js';

const scheduleRoutes = new Hono();

const weekParam = (value: string | undefined) => (value && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : new Date());

// GET /schedule/week?start=YYYY-MM-DD — my classes in that week (Mon–Sun, Kyiv)
// `synced` is false while the student hasn't pressed "Sync with Google Calendar" on schedule.kse.ua
scheduleRoutes.get('/week', async (c) => {
  const user = c.get('dbUser');
  const connected = !!(await GoogleService.getAccount(user.id));
  const synced = connected && (await ScheduleService.calendarIds(user.id)).size > 0;
  const events = synced ? await ScheduleService.weekEvents(user.id, weekParam(c.req.query('start'))) : [];
  return c.json({ connected, synced, events });
});

// POST /schedule/refresh — re-read my course calendars now (after syncing on schedule.kse.ua)
scheduleRoutes.post('/refresh', async (c) => {
  const account = await GoogleService.getAccount(c.get('dbUser').id);
  if (!account) throw new AppError('Спершу підключи пошту KSE', 400);
  const calendars = await ScheduleService.syncAccount(account);
  AnalyticsService.track(account.userId, 'schedule.refresh', { calendars });
  return c.json({ calendars });
});

// GET /schedule/search?q=петренко — students with a visible schedule
scheduleRoutes.get('/search', async (c) => {
  const students = await ScheduleService.searchStudents(c.req.query('q') ?? '', c.get('dbUser').id);
  AnalyticsService.track(c.get('dbUser').id, 'schedule.search', { found: students.length });
  return c.json({ students });
});

// GET /schedule/compare/:userId?start=YYYY-MM-DD — their week, shared classes marked
scheduleRoutes.get('/compare/:userId', async (c) => {
  const otherId = parseInt(c.req.param('userId'), 10);
  if (!Number.isFinite(otherId)) throw new AppError('Bad user id', 400);
  AnalyticsService.track(c.get('dbUser').id, 'schedule.compare');
  return c.json(await ScheduleService.compare(c.get('dbUser').id, otherId, weekParam(c.req.query('start'))));
});

export { scheduleRoutes };
