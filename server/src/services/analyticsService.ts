import { waitUntil } from '@vercel/functions';
import { db } from '../db/connection.js';
import { usageEvents } from '../db/schema.js';
import { and, count, eq, gte } from 'drizzle-orm';
import { kyivDate, kyivDayStart } from '../utils/kyivTime.js';

/** Events the mini app may report itself; everything else is recorded server-side. */
// Screen views and funnel steps the mini app may report (PRODUCT.md → funnels)
export const CLIENT_EVENTS = /^(app\.open|tab\.(today|study|rooms|opps|schedule|moodle|venture|careers|copilot)|rooms\.open|room\.select|deadline\.(done|moodle_open)|moodle\.connected|schedule\.friend_added|onboarding\.(step|skip)\.[a-z]+)$/;

export class AnalyticsService {
  /**
   * Fire-and-forget: analytics must never break or slow the feature it measures.
   * waitUntil keeps the Vercel function alive until the insert lands.
   */
  static track(userId: number | null, event: string, props?: Record<string, unknown>) {
    waitUntil(
      db.insert(usageEvents).values({ userId, event, props: props ?? null })
        .catch((err) => console.error('analytics insert failed:', err))
    );
  }

  /** How many times the user triggered `event` since midnight Kyiv. */
  static async countToday(userId: number, event: string): Promise<number> {
    const [row] = await db.select({ n: count() }).from(usageEvents)
      .where(and(eq(usageEvents.userId, userId), eq(usageEvents.event, event), gte(usageEvents.createdAt, kyivDayStart(kyivDate()))));
    return row?.n ?? 0;
  }
}
