import { Hono } from 'hono';
import { MoodleService } from '../services/moodleService.js';
import { db } from '../db/connection.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';

const moodleRoutes = new Hono();

// POST /moodle/sync — Sync courses + assignments from iCal calendar URL
moodleRoutes.post('/sync', async (c) => {
  const user = c.get('dbUser');
  const body = await c.req.json().catch(() => ({}));
  const calendarUrl = body.calendarUrl || user.calendarUrl;

  if (!calendarUrl) {
    return c.json({ error: 'Calendar URL not configured. Add it in Profile Settings.' }, 400);
  }

  // If new calendarUrl provided in body, persist it
  if (body.calendarUrl && body.calendarUrl !== user.calendarUrl) {
    await db
      .update(users)
      .set({ calendarUrl: body.calendarUrl })
      .where(eq(users.id, user.id));
  }

  const result = await MoodleService.syncCalendar(user.id, calendarUrl);
  return c.json({ message: 'Sync complete', ...result });
});

// GET /moodle/courses — Get user's courses
moodleRoutes.get('/courses', async (c) => {
  const user = c.get('dbUser');
  const courses = await MoodleService.getUserCourses(user.id);
  return c.json({ courses });
});

// GET /moodle/deadlines — Get upcoming deadlines
moodleRoutes.get('/deadlines', async (c) => {
  const user = c.get('dbUser');
  const includeCompleted = c.req.query('completed') === 'true';
  const deadlines = await MoodleService.getDeadlines(user.id, includeCompleted);
  return c.json({ deadlines });
});

// PATCH /moodle/assignments/:id/toggle — Toggle completion
moodleRoutes.patch('/assignments/:id/toggle', async (c) => {
  const assignmentId = parseInt(c.req.param('id'));
  const user = c.get('dbUser');
  const assignment = await MoodleService.toggleCompleted(assignmentId, user.id);
  return c.json({ assignment });
});

export { moodleRoutes };
