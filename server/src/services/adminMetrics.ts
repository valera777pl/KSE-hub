/*
 * Admin analytics: the SQL in routes/admin.ts returns raw per-user rows and counts,
 * these pure functions turn them into percentages, cohorts and alerts (tested without a database).
 */

/** Onboarding funnel, in order. A user who reached a later step has passed every earlier one. */
export const FUNNEL_STEPS = [
  { key: 'start', events: [] as string[] },
  { key: 'auth', events: ['google.connected'] },
  { key: 'schedule', events: ['onboarding.step.synced'] },
  { key: 'program', events: ['onboarding.step.program'] },
  { key: 'digest', events: ['onboarding.step.digest'] },
  { key: 'moodle', events: ['onboarding.step.moodle', 'onboarding.step.visibility'] },
  { key: 'done', events: ['onboarding.completed'] },
] as const;

export const FUNNEL_EVENTS = FUNNEL_STEPS.flatMap((s) => s.events);

export type FunnelStep = { key: string; users: number; pct: number; dropped: number };

/** `users`: the events each new user has from FUNNEL_EVENTS. Everyone new counts as "start". */
export function funnel(users: string[][]): FunnelStep[] {
  const reached = users.map((events) => {
    let max = 0;
    FUNNEL_STEPS.forEach((step, i) => { if (step.events.some((e) => events.includes(e))) max = i; });
    return max;
  });
  const total = users.length;
  return FUNNEL_STEPS.map((step, i) => {
    const count = reached.filter((r) => r >= i).length;
    const prev = i === 0 ? count : reached.filter((r) => r >= i - 1).length;
    return { key: step.key, users: count, pct: pct(count, total), dropped: prev - count };
  });
}

/** Retention windows in days after onboarding: D1 is the next day, D7 the second week, and so on. */
export const RETENTION = [
  { key: 'd1', from: 1, to: 1 },
  { key: 'd7', from: 7, to: 13 },
  { key: 'd14', from: 14, to: 20 },
  { key: 'd30', from: 30, to: 36 },
] as const;

export type Cohort = { week: string; size: number } & Record<'d1' | 'd7' | 'd14' | 'd30', number | null>;

/**
 * `users`: onboarding day (YYYY-MM-DD, Kyiv) and the day offsets the user was active on.
 * Cohort = the Monday of the onboarding week. A cell is null until every user in it could have reached the window.
 */
export function retention(users: { day: string; offsets: number[] }[], today: string): Cohort[] {
  const byWeek = new Map<string, { day: string; offsets: number[] }[]>();
  for (const u of users) {
    const week = mondayOf(u.day);
    byWeek.set(week, [...(byWeek.get(week) ?? []), u]);
  }
  return [...byWeek.entries()]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([week, members]) => {
      const cohort = { week, size: members.length } as Cohort;
      for (const w of RETENTION) {
        // Only users whose window has started count, so a fresh cohort isn't shown as 0%
        const eligible = members.filter((m) => daysBetween(m.day, today) >= w.from);
        cohort[w.key] = eligible.length < members.length || !eligible.length
          ? null
          : pct(eligible.filter((m) => m.offsets.some((o) => o >= w.from && o <= w.to)).length, eligible.length);
      }
      return cohort;
    });
}

/** Activation: onboarded and active again the next day. `users` are those whose next day is over. */
export function activation(users: { offsets: number[] }[]) {
  const activated = users.filter((u) => u.offsets.includes(1)).length;
  return { eligible: users.length, activated, rate: pct(activated, users.length) };
}

export type FeatureUse = { key: string; users: number; prev: number; share: number; trend: number; dead: boolean };

/** Below this share of the period's active users a feature is "dead". */
export const DEAD_SHARE = 5;

/**
 * Unique users per feature this period and the one before. `keys` lists every feature,
 * so one nobody touched still shows up (as dead) instead of disappearing.
 */
export function features(rows: { key: string; users: number; prev: number }[], active: number, keys: readonly string[]): FeatureUse[] {
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return keys
    .map((key) => {
      const r = byKey.get(key) ?? { users: 0, prev: 0 };
      const share = pct(r.users, active);
      return { key, users: r.users, prev: r.prev, share, trend: r.users - r.prev, dead: share < DEAD_SHARE };
    })
    .sort((a, b) => b.users - a.users || a.key.localeCompare(b.key));
}

export type PushStat = { type: string; sent: number; opened: number; ctr: number };

export function pushes(sent: { type: string; n: number }[], opened: { type: string; n: number }[]): PushStat[] {
  const types = new Set([...sent, ...opened].map((r) => r.type));
  const get = (rows: { type: string; n: number }[], type: string) => rows.find((r) => r.type === type)?.n ?? 0;
  return [...types]
    .map((type) => {
      const s = get(sent, type);
      const o = get(opened, type);
      return { type, sent: s, opened: o, ctr: pct(o, s) };
    })
    .sort((a, b) => b.sent - a.sent);
}

export type Health = { key: string; value: number; total: number; alert: boolean };

/** Thresholds: share of onboarded students (or an absolute count) above which the tile goes red. */
const HEALTH_LIMITS: Record<string, { share?: number; count?: number }> = {
  mail_revoked: { share: 10 },
  no_schedule: { share: 30 },
  no_moodle: { share: 60 },
  digest_failed: { count: 1 },
  bot_blocked: { share: 10 },
};

export function health(counts: Record<string, number>, onboarded: number): Health[] {
  return Object.entries(HEALTH_LIMITS).map(([key, limit]) => {
    const value = counts[key] ?? 0;
    const alert = limit.count !== undefined ? value >= limit.count : pct(value, onboarded) > (limit.share ?? 100);
    return { key, value, total: onboarded, alert };
  });
}

/** Whole percent, 0 when there's nothing to divide by. */
export function pct(part: number, whole: number) {
  return whole > 0 ? Math.round((part / whole) * 100) : 0;
}

function daysBetween(from: string, to: string) {
  return Math.round((Date.parse(to) - Date.parse(from)) / 86_400_000);
}

function mondayOf(day: string) {
  const d = new Date(`${day}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7));
  return d.toISOString().slice(0, 10);
}
