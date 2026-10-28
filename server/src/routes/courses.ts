import { Hono } from 'hono';
import { CourseService } from '../services/courseService.js';
import { AnalyticsService } from '../services/analyticsService.js';

const courseRoutes = new Hono();

// GET /courses/ECON100 — the course page
courseRoutes.get('/:code', async (c) => {
  const userId = c.get('dbUser').id;
  return c.json(await CourseService.page(userId, c.req.param('code').toUpperCase()));
});

// GET /courses/ECON100/mail — newest emails about it, searched in Gmail on the spot
courseRoutes.get('/:code/mail', async (c) => {
  const emails = await CourseService.mail(c.get('dbUser').id, c.req.param('code').toUpperCase()).catch(() => null);
  if (!emails) AnalyticsService.track(c.get('dbUser').id, 'course.mail_failed');
  return c.json({ emails: emails ?? [], failed: !emails });
});

export { courseRoutes };
