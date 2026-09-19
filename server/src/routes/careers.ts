import { Hono } from 'hono';
import { db } from '../db/connection.js';
import { opportunities } from '../db/schema.js';
import { eq, ilike, and, gte, desc } from 'drizzle-orm';
import { opportunityFilterSchema } from '../utils/validators.js';

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
    conditions.push(
      ilike(opportunities.title, `%${filters.search}%`)
    );
  }

  // Only show active opportunities (deadline >= now or no deadline)
  conditions.push(gte(opportunities.deadline, new Date()));

  const results = await db
    .select()
    .from(opportunities)
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(opportunities.createdAt))
    .limit(50);

  return c.json({ opportunities: results });
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
