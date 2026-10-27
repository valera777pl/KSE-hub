import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freeFrom } from '../services/bookingService.js';

const at = (hm: string) => new Date(`2026-10-27T${hm}:00Z`);
const b = (from: string, to: string) => ({ startTime: at(from), endTime: at(to) });
const HOUR = 3_600_000;

test('free right after the booking that blocks the window', () => {
  assert.equal(freeFrom([b('10:00', '11:00')], at('10:30'), HOUR), at('11:00').toISOString());
});

test('skips back-to-back bookings and gaps too short for the slot', () => {
  assert.equal(freeFrom([b('10:00', '11:00'), b('11:30', '12:00')], at('10:15'), HOUR), at('12:00').toISOString());
});

test('a gap long enough is taken', () => {
  assert.equal(freeFrom([b('10:00', '11:00'), b('12:30', '13:00')], at('10:15'), HOUR), at('11:00').toISOString());
});
