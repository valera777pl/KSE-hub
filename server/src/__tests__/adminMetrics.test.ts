import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activation, features, funnel, health, pct, pushes, retention } from '../services/adminMetrics.js';
import { cleanProps } from '../services/analyticsService.js';
import { aiTopic } from '../utils/aiTopic.js';

test('funnel: a later step implies the earlier ones, drop-off is per step', () => {
  const steps = funnel([
    [],
    ['google.connected'],
    ['google.connected', 'onboarding.step.synced', 'onboarding.step.program'],
    // finished without some step events (e.g. joined before they were tracked): still counted through
    ['onboarding.completed'],
  ]);
  assert.deepEqual(steps.map((s) => s.users), [4, 3, 2, 2, 1, 1, 1]);
  assert.deepEqual(steps.map((s) => s.dropped), [0, 1, 1, 0, 1, 0, 0]);
  assert.equal(steps[0].pct, 100);
  assert.equal(steps.at(-1)!.pct, 25);
});

test('funnel of nobody is all zeros', () => {
  assert.ok(funnel([]).every((s) => s.users === 0 && s.pct === 0));
});

test('retention: cohorts by onboarding week, windows not reached yet are null', () => {
  const cohorts = retention([
    { day: '2026-10-05', offsets: [0, 1, 8] }, // Monday
    { day: '2026-10-07', offsets: [0, 2] },
    { day: '2026-10-26', offsets: [0, 1] },
  ], '2026-10-28');
  assert.deepEqual(cohorts.map((c) => c.week), ['2026-10-26', '2026-10-05']);
  const [fresh, old] = cohorts;
  assert.equal(fresh.d1, 100);
  assert.equal(fresh.d7, null);
  assert.equal(old.size, 2);
  assert.equal(old.d1, 50);
  assert.equal(old.d7, 50);
  assert.equal(old.d14, 0);
  assert.equal(old.d30, null);
});

test('activation counts only a return on the next day', () => {
  assert.deepEqual(activation([{ offsets: [0, 1] }, { offsets: [0, 3] }, { offsets: [] }]), { eligible: 3, activated: 1, rate: 33 });
});

test('features: share of active users, trend, dead below 5%, untouched features still listed', () => {
  const list = features([{ key: 'tab.rooms', users: 12, prev: 8 }, { key: 'tab.people', users: 1, prev: 2 }], 40, ['tab.rooms', 'tab.people', 'opp.saved']);
  assert.deepEqual(list.map((f) => f.key), ['tab.rooms', 'tab.people', 'opp.saved']);
  assert.deepEqual(list[0], { key: 'tab.rooms', users: 12, prev: 8, share: 30, trend: 4, dead: false });
  assert.equal(list[1].dead, true);
  assert.equal(list[2].users, 0);
  assert.equal(list[2].dead, true);
});

test('pushes: sent vs opened per type, CTR', () => {
  const stats = pushes([{ type: 'digest', n: 20 }, { type: 'd24', n: 4 }], [{ type: 'digest', n: 5 }, { type: 'change', n: 1 }]);
  assert.deepEqual(stats[0], { type: 'digest', sent: 20, opened: 5, ctr: 25 });
  assert.deepEqual(stats.find((s) => s.type === 'change'), { type: 'change', sent: 0, opened: 1, ctr: 0 });
});

test('health: share and count thresholds', () => {
  const tiles = Object.fromEntries(health({ mail_revoked: 2, no_schedule: 1, digest_failed: 1, bot_blocked: 0 }, 10).map((h) => [h.key, h.alert]));
  assert.deepEqual(tiles, { mail_revoked: true, no_schedule: false, no_moodle: false, digest_failed: true, bot_blocked: false });
});

test('pct rounds and never divides by zero', () => {
  assert.equal(pct(1, 3), 33);
  assert.equal(pct(5, 0), 0);
});

test('client props: flat, short, at most 5 keys', () => {
  assert.deepEqual(cleanProps({ tab: 'rooms', n: 3, ok: true, nested: { a: 1 }, 'Bad-Key': 'x' }), { tab: 'rooms', n: 3, ok: true });
  assert.equal(String(cleanProps({ a: 'x'.repeat(100) })!.a).length, 40);
  assert.equal(cleanProps('rooms'), undefined);
  assert.equal(cleanProps({ nested: {} }), undefined);
  assert.equal(Object.keys(cleanProps({ a: 1, b: 1, c: 1, d: 1, e: 1, f: 1 })!).length, 5);
});

test('AI topic: tools first, then keywords, never the text', () => {
  assert.equal(aiTopic(['get_available_rooms', 'book_room'], 'хочу кімнату'), 'rooms');
  assert.equal(aiTopic([], 'коли дедлайн з ECON?'), 'deadlines');
  assert.equal(aiTopic([], 'привіт'), 'other');
});
