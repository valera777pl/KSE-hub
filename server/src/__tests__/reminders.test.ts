import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FRIEND_REMINDERS_PER_DAY, reminderText, reminderWhen, validRemindAt } from '../utils/reminders.js';

const now = new Date('2026-10-28T10:00:00Z');

test('a reminder must be at least a minute ahead and within a year', () => {
  assert.equal(validRemindAt(new Date('2026-10-28T10:00:30Z'), now), false);
  assert.equal(validRemindAt(new Date('2026-10-30T15:00:00Z'), now), true);
  assert.equal(validRemindAt(new Date('2028-01-01T00:00:00Z'), now), false);
  assert.equal(validRemindAt(new Date('nonsense'), now), false);
});

test('Copilot confirms in the bot\'s short date: «пт 30.10 о 18:00»', () => {
  assert.equal(reminderWhen(new Date('2026-10-30T16:00:00Z'), 'uk'), 'пт 30.10 о 18:00');
  assert.equal(reminderWhen(new Date('2026-10-30T16:00:00Z'), 'en'), 'fri 30.10 at 18:00');
});

test('reminder messages: mine, from a friend, before an event', () => {
  assert.equal(reminderText('self', 'почати есе <ECON>', 'uk'), '<b>Нагадування</b>\nпочати есе &lt;ECON&gt;');
  assert.equal(reminderText('friend', 'ECON100 PS3 — пт 30.10, 23:59', 'uk', 'Олег'), '<b>Олег нагадує</b>\nECON100 PS3 — пт 30.10, 23:59');
  assert.equal(reminderText('event', 'Завтра о 18:00 — Семінар\nICU Hall', 'uk'), '<b>Завтра о 18:00 — Семінар</b>\nICU Hall');
});

test('a friend can be nudged at most 5 times a day', () => {
  assert.equal(FRIEND_REMINDERS_PER_DAY, 5);
});
