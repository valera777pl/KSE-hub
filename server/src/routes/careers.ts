import { Hono } from 'hono';
import { db } from '../db/connection.js';
import { emails, googleAccounts, opportunities, savedOpportunities } from '../db/schema.js';
import { eq, ilike, and, gte, desc, isNull, or, inArray } from 'drizzle-orm';
import { opportunityFilterSchema } from '../utils/validators.js';
import { AnalyticsService } from '../services/analyticsService.js';

const careerRoutes = new Hono();

// GET /careers — List opportunities with filters
careerRoutes.get('/', async (c) => {
  const filters = opportunityFilterSchema.parse({
    eligibility: c.req.query('eligibility'),
    category: c.req.query('category'),
    domain: c.req.query('domain'),
    search: c.req.query('search'),
  });

  const conditions: any[] = [];

  if (filters.eligibility) {
    conditions.push(eq(opportunities.eligibility, filters.eligibility as any));
  }

  if (filters.category) {
    conditions.push(eq(opportunities.category, filters.category as any));
  }

  if (filters.domain) {
    conditions.push(ilike(opportunities.domain, `%${filters.domain}%`));
  }

  if (filters.search) {
    const like = `%${filters.search}%`;
    conditions.push(or(ilike(opportunities.title, like), ilike(opportunities.company, like), ilike(opportunities.description, like)));
  }

  const user = c.get('dbUser');
  const mySaved = await db.select({ id: savedOpportunities.opportunityId }).from(savedOpportunities).where(eq(savedOpportunities.userId, user.id));
  const savedIds = new Set(mySaved.map((s) => s.id));
  if (c.req.query('saved') === 'true') {
    if (savedIds.size === 0) return c.json({ opportunities: [] });
    conditions.push(inArray(opportunities.id, [...savedIds]));
  }

  if (c.req.query('source') === 'email') {
    conditions.push(ilike(opportunities.slackMessageId, 'summary:%'));
  }

  // Still open: deadline ahead, or none given (most opportunities found in emails)
  conditions.push(or(isNull(opportunities.deadline), gte(opportunities.deadline, new Date())));

  const results = await db
    .select()
    .from(opportunities)
    .where(and(...conditions))
    .orderBy(desc(opportunities.createdAt))
    .limit(50);

  // For opportunities found in mail: a link to the viewer's own copy of that email
  const summaryIds = results
    .map((o) => o.slackMessageId?.match(/^summary:(\d+)$/)?.[1])
    .filter(Boolean)
    .map(Number);
  const [account] = await db.select({ email: googleAccounts.email }).from(googleAccounts).where(eq(googleAccounts.userId, user.id)).limit(1);
  const myCopies = summaryIds.length && account
    ? await db.select({ summaryId: emails.summaryId, gmailId: emails.gmailId }).from(emails)
        .where(and(eq(emails.userId, user.id), inArray(emails.summaryId, summaryIds)))
    : [];
  const gmailLink = new Map(myCopies.map((m) => [m.summaryId, `https://mail.google.com/mail/?authuser=${encodeURIComponent(account!.email)}#all/${m.gmailId}`]));

  return c.json({
    opportunities: results.map(({ slackMessageId, ...o }) => {
      const summaryId = Number(slackMessageId?.match(/^summary:(\d+)$/)?.[1]) || null;
      return { ...o, saved: savedIds.has(o.id), source: summaryId ? 'email' : 'manual', emailUrl: summaryId ? gmailLink.get(summaryId) ?? null : null };
    }),
  });
});

// POST /careers/:id/save — save or unsave (body { saved: boolean }); saved ones get a reminder 3 days before the deadline
careerRoutes.post('/:id/save', async (c) => {
  const id = parseInt(c.req.param('id'), 10);
  const { saved } = await c.req.json().catch(() => ({ saved: true }));
  const userId = c.get('dbUser').id;
  if (saved === false) {
    await db.delete(savedOpportunities).where(and(eq(savedOpportunities.userId, userId), eq(savedOpportunities.opportunityId, id)));
  } else {
    const [opp] = await db.select({ id: opportunities.id }).from(opportunities).where(eq(opportunities.id, id)).limit(1);
    if (!opp) return c.json({ error: 'Такої можливості вже немає' }, 404);
    await db.insert(savedOpportunities).values({ userId, opportunityId: id }).onConflictDoNothing();
    AnalyticsService.track(userId, 'opp.saved');
  }
  return c.json({ saved: saved !== false });
});

// GET /careers/:id — Single opportunity
careerRoutes.get('/:id', async (c) => {
  const id = parseInt(c.req.param('id'));
  const [opp] = await db
    .select()
    .from(opportunities)
    .where(eq(opportunities.id, id))
    .limit(1);

  if (!opp) return c.json({ error: 'Opportunity not found' }, 404);
  return c.json({ opportunity: opp });
});

export { careerRoutes };
