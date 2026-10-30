import { Hono } from 'hono';
import { MoodleService } from '../services/moodleService.js';
import { db } from '../db/connection.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { z } from 'zod';
import type { Context } from 'hono';
import { MoodleGradesService } from '../services/moodleGradesService.js';
import { AppError } from '../middleware/errorHandler.js';

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

/* ─── Grades: owner-only experiment, not for students until KSE IT agrees (019_moodle_grades.sql) ─── */

const adminOnly = (c: Context) => {
  const user = c.get('dbUser');
  if (!user.isAdmin) throw new AppError('Поки що це тест і він вимкнений', 403);
  return user;
};
const connectSchema = z.object({ link: z.string().min(10).max(4000), passport: z.string().min(10).max(500) });

// GET /moodle/grades/start — Moodle's sign-in page link for this student
moodleRoutes.get('/grades/start', (c) => c.json(MoodleGradesService.start(adminOnly(c).id)));

// POST /moodle/grades/connect — the "open in app" link the student copied after signing in
moodleRoutes.post('/grades/connect', async (c) => {
  const user = adminOnly(c);
  const { link, passport } = connectSchema.parse(await c.req.json());
  return c.json(await MoodleGradesService.connect(user.id, link, passport));
});

// GET /moodle/grades — every course with its total; GET /moodle/grades/:courseId — the items
moodleRoutes.get('/grades', async (c) => c.json(await MoodleGradesService.overview(adminOnly(c).id)));
moodleRoutes.get('/grades/:courseId', async (c) => {
  const user = adminOnly(c);
  const id = parseInt(c.req.param('courseId'), 10);
  if (!Number.isSafeInteger(id)) throw new AppError('Bad id', 400);
  return c.json(await MoodleGradesService.course(user.id, id));
});

// DELETE /moodle/grades — forget the token
moodleRoutes.delete('/grades', async (c) => c.json(await MoodleGradesService.disconnect(adminOnly(c).id)));

export { moodleRoutes };
