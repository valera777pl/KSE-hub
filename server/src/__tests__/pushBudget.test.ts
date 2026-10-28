import { test } from 'node:test';
import assert from 'node:assert/strict';
import { budgetAllows, PUSH_PRIORITY } from '../services/pushService.js';
import { chatCutoff } from '../services/cronService.js';

test('a schedule change always goes out, even over the budget', () => {
  assert.equal(budgetAllows('change', 0), true);
  assert.equal(budgetAllows('change', 5), true);
});

test('3-hour deadline and urgent mail take any of the 3 slots', () => {
  assert.equal(budgetAllows('d3', 2), true);
  assert.equal(budgetAllows('d3', 3), false);
  assert.equal(budgetAllows('urgent', 3), false);
});

test('24-hour deadline and opportunities leave the last slot for something urgent', () => {
  assert.equal(budgetAllows('d24', 1), true);
  assert.equal(budgetAllows('d24', 2), false);
  assert.equal(budgetAllows('opp', 2), false);
});

test('the digest, own reminders, friends and replies are outside the budget', () => {
  for (const type of ['digest', 'weekly', 'remind', 'friend', 'soon', 'booking_end', 'onboarding'] as const) {
    assert.equal(PUSH_PRIORITY[type], undefined);
    assert.equal(budgetAllows(type, 10), true);
  }
});

test('Copilot history older than 7 days is what the cleanup deletes', () => {
  const now = new Date('2026-10-28T02:00:00Z');
  assert.equal(chatCutoff(now).toISOString(), '2026-10-21T02:00:00.000Z');
});
