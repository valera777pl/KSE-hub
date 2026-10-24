import { Hono } from 'hono';
import { db } from '../db/connection.js';
import { ventureProfiles, ventureProjects } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { MatchingService } from '../services/matchingService.js';
import { StartupService, contactLink } from '../services/startupService.js';
import { z } from 'zod';
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

// GET /venture/projects — My startups (open and closed)
ventureRoutes.get('/projects', async (c) => {
  return c.json({ projects: await StartupService.mine(c.get('dbUser').id) });
});

// POST /venture/projects — Create a startup
ventureRoutes.post('/projects', async (c) => {
  const data = ventureProjectSchema.parse(await c.req.json());
  return c.json({ project: await StartupService.save(c.get('dbUser').id, data) }, 201);
});

// PUT /venture/projects/:id — Edit my startup (owner only)
ventureRoutes.put('/projects/:id', async (c) => {
  const data = ventureProjectSchema.parse(await c.req.json());
  return c.json({ project: await StartupService.save(c.get('dbUser').id, data, parseInt(c.req.param('id'), 10)) });
});

// POST /venture/projects/:id/close — Stop recruiting
ventureRoutes.post('/projects/:id/close', async (c) => {
  return c.json({ project: await StartupService.close(c.get('dbUser').id, parseInt(c.req.param('id'), 10)) });
});

// ─── Startups & applications ───

// GET /venture/startups?q=&role= — Open startups of other students
ventureRoutes.get('/startups', async (c) => {
  const startups = await StartupService.list(c.get('dbUser').id, { query: c.req.query('q') || undefined, role: c.req.query('role') || undefined });
  return c.json({ startups });
});

const applySchema = z.object({ role: z.string().max(100).optional(), message: z.string().max(500).optional() });

// POST /venture/projects/:id/apply — Ask to join
ventureRoutes.post('/projects/:id/apply', async (c) => {
  const { role, message } = applySchema.parse(await c.req.json().catch(() => ({})));
  const application = await StartupService.apply(c.get('dbUser').id, parseInt(c.req.param('id'), 10), role, message);
  return c.json({ application }, 201);
});

// GET /venture/applications — To my startups (incoming) and mine (outgoing)
ventureRoutes.get('/applications', async (c) => {
  return c.json(await StartupService.applications(c.get('dbUser').id));
});

// POST /venture/applications/:id/decide { accept } — Author's answer
ventureRoutes.post('/applications/:id/decide', async (c) => {
  const { accept } = z.object({ accept: z.boolean() }).parse(await c.req.json());
  const { application, applicant } = await StartupService.decide(c.get('dbUser').id, parseInt(c.req.param('id'), 10), accept);
  return c.json({ application, contact: application.status === 'accepted' ? contactLink(applicant) : null });
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
