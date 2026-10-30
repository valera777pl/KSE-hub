import { waitUntil } from '@vercel/functions';
import { db } from '../db/connection.js';
import { usageEvents } from '../db/schema.js';
import { and, count, eq, gte } from 'drizzle-orm';
import { kyivDate, kyivDayStart } from '../utils/kyivTime.js';

/** Events the mini app may report itself; everything else is recorded server-side. */
// Screen views, push opens, funnel steps and actions the mini app may report (PRODUCT.md → funnels, NEXT-PROMPT.md §2)
export const CLIENT_EVENTS = /^(app\.open|tab\.(view|today|study|rooms|opps|schedule|moodle|venture|careers|copilot|slack)|push\.open|rooms\.open|room\.select|booking\.confirm|opps\.open|opp\.apply_click|deadline\.(done|moodle_open|sheet_open|feedback_open|grade_open)|moodle\.connected|schedule\.(friend_added|zoom)|courses\.open|course\.(open|slack_open|material_open)|event\.(open|register_click)|slack\.(feed|open|subscribe|slot)|invite\.sent|onboarding\.(step|skip)\.[a-z]+)$/;

/** Client props are untrusted: at most 5 flat keys, short strings, finite numbers, booleans. */
export function cleanProps(raw: unknown): Record<string, string | number | boolean> | undefined {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return undefined;
  const out: Record<string, string | number | boolean> = {};
  for (const [key, value] of Object.entries(raw).slice(0, 5)) {
    if (!/^[a-z_]{1,20}$/.test(key)) continue;
    if (typeof value === 'string') out[key] = value.slice(0, 40);
    else if (typeof value === 'boolean' || (typeof value === 'number' && Number.isFinite(value))) out[key] = value;
  }
  return Object.keys(out).length ? out : undefined;
}

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
