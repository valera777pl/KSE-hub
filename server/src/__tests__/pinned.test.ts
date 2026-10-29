import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayLine, nextClassLine, nextDeadlineLine } from '../utils/pinned.js';

const kyiv = (local: string) => new Date(`${local}+02:00`); // Kyiv after 25 Oct 2026 is UTC+2
const cls = (code: string, section: string, from: string, to: string, location = 'M. Shpaka 3, 1.08.2 Roy Gartner Room') =>
  ({ courseCode: code, section, location, startAt: kyiv(from), endAt: kyiv(to) });

const week = [
  cls('MATH101', 'P8', '2026-10-29T11:30', '2026-10-29T12:50'),
  cls('KSE101', 'L3', '2026-10-29T15:00', '2026-10-29T16:20', 'Online'),
  cls('MATH111', 'P6', '2026-10-30T10:00', '2026-10-30T11:20', 'M. Shpaka 3, 3.05'),
];

test('next class: one short line, as the owner asked', () => {
  assert.equal(nextClassLine(week, kyiv('2026-10-29T10:00'), 'uk'), 'Далі: MATH101 [P8] о 11:30 · M. Shpaka 3, 1.08.2');
  assert.equal(nextClassLine(week, kyiv('2026-10-29T12:00'), 'uk'), 'Зараз: MATH101 [P8] до 12:50 · M. Shpaka 3, 1.08.2');
  assert.equal(nextClassLine(week, kyiv('2026-10-29T13:00'), 'uk'), 'Далі: KSE101 [L3] о 15:00 · Онлайн');
  assert.equal(nextClassLine(week, kyiv('2026-10-29T17:00'), 'uk'), 'Завтра: MATH111 [P6] о 10:00 · M. Shpaka 3, 3.05');
  assert.equal(nextClassLine([], kyiv('2026-10-29T17:00'), 'uk'), 'Пар найближчим часом немає');
});

test('nearest deadline', () => {
  const dl = [{ title: 'Problem set 4', courseName: 'ECON100 Principles of Economics', dueDate: kyiv('2026-10-30T23:59') }];
  assert.equal(nextDeadlineLine(dl, kyiv('2026-10-29T10:00'), 'uk'), 'Дедлайн: ECON100 Problem set 4 — пт 30.10, 23:59');
  assert.equal(nextDeadlineLine([], kyiv('2026-10-29T10:00'), 'uk'), 'Дедлайнів найближчим часом немає');
});

test('the day in brief, then tomorrow once today is over', () => {
  const dl = [{ title: 'Quiz', courseName: 'MATH101', dueDate: kyiv('2026-10-29T23:59') }];
  assert.equal(dayLine(week, dl, kyiv('2026-10-29T10:00'), 'uk'), 'Сьогодні: 2 пари · 1 дедлайн');
  assert.equal(dayLine(week, [], kyiv('2026-10-29T17:00'), 'uk'), 'Завтра: 1 пара · перша о 10:00');
  assert.equal(dayLine([], [], kyiv('2026-10-29T17:00'), 'uk'), 'Сьогодні й завтра вільно');
});
