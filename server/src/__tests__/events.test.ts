import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventReminderText, eventRemindAt, isMassMailing, parseKyivLocal } from '../utils/events.js';
import { digestText } from '../bot/messages.js';

test('the model\'s Kyiv wall-clock time becomes the right instant', () => {
  assert.equal(parseKyivLocal('2026-10-30T18:00')!.toISOString(), '2026-10-30T16:00:00.000Z');
  // after the switch to winter time (25 Oct 2026) Kyiv is UTC+2
  assert.equal(parseKyivLocal('2026-11-05T18:00')!.toISOString(), '2026-11-05T16:00:00.000Z');
  assert.equal(parseKyivLocal(null), null);
  assert.equal(parseKyivLocal('next Friday'), null);
});

test('mailings are for everyone, a personal invite is not', () => {
  const h = { to: '', cc: '', listId: '', precedence: '' };
  const me = 'ivan.petrenko.26@kse.org.ua';
  assert.equal(isMassMailing({ ...h, to: 'students@kse.org.ua' }, me), true);
  assert.equal(isMassMailing({ ...h, to: 'someone@kse.org.ua' }, me), true); // I was in Bcc
  assert.equal(isMassMailing({ ...h, to: me, listId: '<sdo.kse.org.ua>' }, me), true);
  assert.equal(isMassMailing({ ...h, to: `Ivan <${me}>` }, me), false);
});

test('«Нагадати за день» fires the day before at 10:00 Kyiv', () => {
  const start = new Date('2026-10-30T16:00:00Z'); // Fri 18:00
  assert.equal(eventRemindAt(start, new Date('2026-10-28T10:00:00Z'))!.toISOString(), '2026-10-29T08:00:00.000Z');
});

test('too late for the day before: in two minutes if the event is 2+ hours away, otherwise not at all', () => {
  const start = new Date('2026-10-30T16:00:00Z');
  const now = new Date('2026-10-30T09:00:00Z');
  assert.equal(eventRemindAt(start, now)!.toISOString(), '2026-10-30T09:02:00.000Z');
  assert.equal(eventRemindAt(start, new Date('2026-10-30T15:00:00Z')), null);
});

test('the reminder says «Завтра» or «Сьогодні» for the day it arrives', () => {
  const e = { title: 'Семінар з відбудови економіки', startsAt: new Date('2026-10-30T16:00:00Z'), location: 'ICU Hall' };
  assert.equal(eventReminderText(e, new Date('2026-10-29T08:00:00Z'), 'uk'), 'Завтра о 18:00 — Семінар з відбудови економіки\nICU Hall');
  assert.equal(eventReminderText(e, new Date('2026-10-30T09:02:00Z'), 'uk'), 'Сьогодні о 18:00 — Семінар з відбудови економіки\nICU Hall');
});

test('an event with a reminder shows up in that day\'s digest', () => {
  const text = digestText({
    lang: 'uk', now: new Date('2026-10-30T06:00:00Z'), day: new Date('2026-10-30T06:00:00Z'), classes: [], deadlines: [],
    events: [{ title: 'Семінар', startsAt: new Date('2026-10-30T16:00:00Z'), location: 'ICU Hall' }], mail: [], slack: [],
  })!;
  assert.match(text, /<b>Події<\/b>\n18:00  Семінар · ICU Hall/);
});
