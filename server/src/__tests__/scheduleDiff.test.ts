import { test } from 'node:test';
import assert from 'node:assert/strict';
import { diffSchedule, type DiffEvent } from '../utils/scheduleDiff.js';

const now = new Date('2026-10-26T08:00:00Z');
const HORIZON = 14 * 86_400_000;
const ev = (id: string, start: string, location = '4.08', title = 'ECON100 Principles'): DiffEvent => ({
  googleEventId: id, title, location,
  startAt: new Date(start), endAt: new Date(new Date(start).getTime() + 80 * 60_000),
});

test('no changes → nothing to tell', () => {
  const a = [ev('1', '2026-10-27T09:30:00Z')];
  assert.deepEqual(diffSchedule(a, [...a], now, HORIZON), []);
});

test('time change is a move', () => {
  const [c] = diffSchedule([ev('1', '2026-10-27T09:30:00Z')], [ev('1', '2026-10-28T11:30:00Z')], now, HORIZON);
  assert.equal(c.kind, 'moved');
});

test('only the room changed', () => {
  const [c] = diffSchedule([ev('1', '2026-10-27T09:30:00Z', '4.08')], [ev('1', '2026-10-27T09:30:00Z', '2.15')], now, HORIZON);
  assert.equal(c.kind, 'room');
});

test('deleted and re-created under a new id at another time reads as moved', () => {
  const changes = diffSchedule([ev('old', '2026-10-27T09:30:00Z')], [ev('new', '2026-10-29T09:30:00Z')], now, HORIZON);
  assert.deepEqual(changes.map((c) => c.kind), ['moved']);
});

test('cancelled and added classes', () => {
  const changes = diffSchedule(
    [ev('1', '2026-10-27T09:30:00Z', '4.08', 'MATH101')],
    [ev('2', '2026-10-30T09:30:00Z', '4.08', 'ECON100')],
    now, HORIZON
  );
  assert.deepEqual(changes.map((c) => c.kind).sort(), ['added', 'cancelled']);
});

test('past classes and classes beyond the horizon are ignored', () => {
  const past = ev('p', '2026-10-20T09:30:00Z');
  const far = ev('f', '2026-12-20T09:30:00Z');
  assert.deepEqual(diffSchedule([past, far], [], now, HORIZON), []);
});
