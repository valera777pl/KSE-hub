import { z } from 'zod';

/*
 * What Claude's scheduled task sends (server/scripts/slack-digest-task.md, SLACK-DIGEST-PROMPT.md §5.1):
 * one entry per channel since its cursor, a short summary or null, every point with a link to the original.
 */

/** Slack message timestamp: "1730000000.123456" */
const ts = z.string().regex(/^\d{9,11}(\.\d{1,6})?$/);
const permalink = z.string().url().regex(/^https:\/\/[a-z0-9-]+\.slack\.com\/archives\//);

export const ingestSchema = z.object({
  channels: z.array(z.object({
    channelId: z.string().regex(/^[CG][A-Z0-9]{6,19}$/),
    channelName: z.string().min(1).max(100).transform((s) => s.replace(/^#/, '').toLowerCase()),
    isPrivate: z.boolean(),
    team: z.string().max(100).optional(),
    fromTs: ts,
    toTs: ts,
    summary: z.string().trim().min(1).max(2000).nullable(),
    items: z.array(z.object({
      kind: z.enum(['deadline', 'change', 'announcement', 'event', 'other']),
      text: z.string().trim().min(1).max(500),
      dueAt: z.string().datetime({ offset: true }).nullish().transform((v) => v ?? undefined),
      permalink,
    })).max(10).default([]),
    events: z.array(z.object({
      title: z.string().trim().min(1).max(300),
      startsAt: z.string().datetime({ offset: true }),
      place: z.string().trim().max(200).nullish().transform((v) => v ?? undefined),
      permalink,
    })).max(10).default([]),
  })).max(300),
});

export type IngestChannel = z.infer<typeof ingestSchema>['channels'][number];

/** Later of two Slack timestamps (they compare as numbers, not strings). */
export function laterTs(a: string | null, b: string): string {
  return a && Number(a) >= Number(b) ? a : b;
}

/** "slack:C07ABCDE12:p1730000000123456" — one event per original message, however often it's summarized. */
export function eventSourceKey(channelId: string, link: string): string {
  const msg = link.match(/\/(p\d+)/)?.[1] ?? link.slice(-40);
  return `slack:${channelId}:${msg}`.slice(0, 100);
}

/** Open channels students get unless they turn them off (SLACK-DIGEST-PROMPT.md §3). */
export const DEFAULT_ON = new Set(['general', 'event']);
