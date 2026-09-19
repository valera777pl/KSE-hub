import { Hono } from 'hono';
import { db } from '../db/connection.js';
import { ventureProfiles, ventureProjects } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { MatchingService } from '../services/matchingService.js';
import { ventureProfileSchema, ventureProjectSchema, swipeSchema } from '../utils/validators.js';

const ventureRoutes = new Hono();

// ─── Profiles ───

// GET /venture/profile — Get my profile
ventureRoutes.get('/profile', async (c) => {
  const user = c.get('dbUser');
  const [profile] = await db
    .select()
    .from(ventureProfiles)
    .where(eq(ventureProfiles.userId, user.id))
    .limit(1);
  return c.json({ profile: profile || null });
});

// POST /venture/profile — Create/Update profile
ventureRoutes.post('/profile', async (c) => {
  const user = c.get('dbUser');
  const body = await c.req.json();
  const data = ventureProfileSchema.parse(body);

  const existing = await db
    .select()
    .from(ventureProfiles)
    .where(eq(ventureProfiles.userId, user.id))
    .limit(1);

  if (existing.length > 0) {
    const [updated] = await db
      .update(ventureProfiles)
      .set({ ...data, updatedAt: new Date() })
      .where(eq(ventureProfiles.userId, user.id))
      .returning();
    return c.json({ profile: updated });
  }

  const [profile] = await db
    .insert(ventureProfiles)
    .values({ ...data, userId: user.id })
    .returning();
  return c.json({ profile }, 201);
});

// ─── Projects ───

// GET /venture/projects — Get my projects
ventureRoutes.get('/projects', async (c) => {
  const user = c.get('dbUser');
  const projects = await db
    .select()
    .from(ventureProjects)
    .where(eq(ventureProjects.userId, user.id));
  return c.json({ projects });
});

// POST /venture/projects — Create project
ventureRoutes.post('/projects', async (c) => {
  const user = c.get('dbUser');
  const body = await c.req.json();
  const data = ventureProjectSchema.parse(body);

  const [project] = await db
    .insert(ventureProjects)
    .values({ ...data, userId: user.id })
    .returning();
  return c.json({ project }, 201);
});

// PUT /venture/projects/:id — Update project
ventureRoutes.put('/projects/:id', async (c) => {
  const projectId = parseInt(c.req.param('id'));
  const user = c.get('dbUser');
  const body = await c.req.json();
  const data = ventureProjectSchema.parse(body);

  const [updated] = await db
    .update(ventureProjects)
    .set({ ...data, updatedAt: new Date() })
    .where(
      eq(ventureProjects.id, projectId)
    )
    .returning();

  if (!updated) return c.json({ error: 'Project not found' }, 404);
  return c.json({ project: updated });
});

// ─── Swipe Deck ───

// GET /venture/deck?type=profile|project
ventureRoutes.get('/deck', async (c) => {
  const user = c.get('dbUser');
  const type = (c.req.query('type') || 'profile') as 'profile' | 'project';
  const cards = await MatchingService.getSwipeDeck(user.id, type);
  return c.json({ cards });
});

// POST /venture/swipe — Record a swipe
ventureRoutes.post('/swipe', async (c) => {
  const user = c.get('dbUser');
  const body = await c.req.json();
  const data = swipeSchema.parse(body);

  const result = await MatchingService.recordSwipe(
    user.id,
    data.targetId,
    data.targetType,
    data.isLike
  );
  return c.json(result);
});

// GET /venture/matches — Get my matches
ventureRoutes.get('/matches', async (c) => {
  const user = c.get('dbUser');
  const matches = await MatchingService.getUserMatches(user.id);
  return c.json({ matches });
});

export { ventureRoutes };
