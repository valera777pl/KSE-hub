import { Hono } from 'hono';
import { and, desc, eq, gt, ne } from 'drizzle-orm';
import { db } from '../db/connection.js';
import { emails, summaries } from '../db/schema.js';
import { GoogleService } from '../services/googleService.js';

const mailRoutes = new Hono();

const LOOKBACK_MS = 3 * 86_400_000;

// GET /mail/important — up to 3 recent letters the model flagged as needing action, for the "Сьогодні" screen
mailRoutes.get('/important', async (c) => {
  const user = c.get('dbUser');
  const account = await GoogleService.getAccount(user.id);
  if (!account) return c.json({ emails: [] });

  const rows = await db
    .select({ id: emails.id, gmailId: emails.gmailId, subject: emails.subject, from: emails.fromName, receivedAt: emails.receivedAt, summary: summaries.summary })
    .from(emails)
    .innerJoin(summaries, eq(emails.summaryId, summaries.id))
    .where(and(
      eq(emails.userId, user.id),
      eq(summaries.important, true),
      ne(summaries.category, 'newsletter'),
      gt(emails.receivedAt, new Date(Date.now() - LOOKBACK_MS)),
    ))
    .orderBy(desc(emails.receivedAt))
    .limit(3);

  return c.json({
    emails: rows.map(({ gmailId, ...r }) => ({
      ...r,
      url: `https://mail.google.com/mail/?authuser=${encodeURIComponent(account.email)}#all/${gmailId}`,
    })),
  });
});

export { mailRoutes };
