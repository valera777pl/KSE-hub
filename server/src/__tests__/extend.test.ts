import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extendBlocker } from '../services/bookingService.js';

const at = (hm: string) => new Date(`2026-10-27T${hm}:00Z`);
const booking = { startTime: at('14:00'), endTime: at('15:00') };

test('extends when the room is free and limits allow', () => {
  assert.equal(extendBlocker(booking, null, 1), null);
  assert.equal(extendBlocker(booking, at('15:30'), 1), null);
});

test('not when someone has the room within the next 30 min', () => {
  assert.match(extendBlocker(booking, at('15:15'), 1)!, /забронювали/);
});

test('not past 3 hours in one booking or 3 hours a day', () => {
  assert.match(extendBlocker({ startTime: at('12:00'), endTime: at('15:00') }, null, 3)!, /3 годин/);
  assert.match(extendBlocker(booking, null, 2.75)!, /квоту/);
});
