import { test } from 'node:test';
import assert from 'node:assert/strict';
import { markdownToTelegramHtml } from '../bot/bot.js';
import { classSoonText, digestText, inTime, onboardedText, scheduleByDay, scheduleChangeText, shortDay, shortPlace } from '../bot/messages.js';

// Kyiv is UTC+2 in late October 2026 (winter time from 25 Oct)
const kyiv = (s: string) => new Date(`${s}+02:00`);

test('places read "корпус, аудиторія" without sponsor names', () => {
  assert.equal(shortPlace('M. Shpaka 3, 2.15.1 Roy Gartner Memorial Classroom'), 'M. Shpaka 3, 2.15.1');
  assert.equal(shortPlace('Y. Myroshnychenko 6/11, F3 Classroom'), 'Y. Myroshnychenko 6/11, F3');
  assert.equal(shortPlace('M. Shpaka 3, 4.08 TAS Group Classroom', 'en'), 'M. Shpaka 3, 4.08');
  assert.equal(shortPlace('Online'), 'Онлайн');
  assert.equal(shortPlace(null), null);
});

test('time to a deadline counts calendar days, hours only today', () => {
  const now = kyiv('2026-10-27T08:00:00');
  assert.equal(inTime(kyiv('2026-10-27T13:00:00'), now, 'uk'), 'через 5 год');
  assert.equal(inTime(kyiv('2026-10-28T23:59:00'), now, 'uk'), 'завтра');
  assert.equal(inTime(kyiv('2026-10-30T15:00:00'), now, 'uk'), 'через 3 дні');
});

test('short day is weekday and dd.mm in Kyiv', () => {
  assert.equal(shortDay(kyiv('2026-10-30T15:00:00'), 'uk'), 'пт 30.10');
});

test('digest follows the template and skips empty sections', () => {
  const text = digestText({
    lang: 'uk', now: kyiv('2026-10-27T07:00:00'), day: kyiv('2026-10-27T07:00:00'),
    classes: [{ courseCode: 'MATH111', section: 'P6', location: 'M. Shpaka 3, 3.05 Genesis Growth Classroom', startAt: kyiv('2026-10-27T10:00:00') }],
    deadlines: [{ title: 'Problem set 4', courseName: 'ECON100 Principles of Economics', dueDate: kyiv('2026-10-30T15:00:00') }],
    mail: [], slack: [],
  })!;
  assert.match(text, /^<b>Вівторок, 27 жовтня<\/b>/);
  assert.match(text, /<b>Пари<\/b>\n10:00  MATH111 \[P6\] · M\. Shpaka 3, 3\.05/);
  assert.match(text, /пт 30\.10, 15:00 · ECON100 · Problem set 4 · через 3 дні/);
  assert.doesNotMatch(text, /Пошта/);
  assert.equal(digestText({ lang: 'uk', now: new Date(), day: new Date(), classes: [], deadlines: [], mail: [], slack: [] }), null);
});

test('a moved class says so in the first line', () => {
  const text = scheduleChangeText('uk', 'ENG111', 'P11', [{
    kind: 'moved',
    before: { startAt: kyiv('2026-11-02T18:00:00') },
    after: { startAt: kyiv('2026-11-05T18:00:00'), location: 'Y. Myroshnychenko 6/11, F4 Classroom' },
  }]);
  assert.equal(text, '<b>Пару перенесли</b>\nENG111 [P11]: пн 2.11 → <b>чт 5.11, 18:00</b>\nY. Myroshnychenko 6/11, F4');
});

test('class in 15 minutes: code, when it starts, place, nothing else', () => {
  assert.equal(classSoonText('uk', 'MATH111', 'P6', 15, 'M. Shpaka 3, 3.05 Genesis', kyiv('2026-10-27T11:30:00')), '<b>MATH111 [P6] через 15 хв, о 11:30</b>\nM. Shpaka 3, 3.05');
  assert.equal(classSoonText('en', 'MATH111', null, 15, null, kyiv('2026-10-27T11:30:00')), '<b>MATH111 in 15 min, at 11:30</b>');
});

test('assistant schedule: grouped by day, one ready line per class', () => {
  const c = (from: string, to: string, code: string, section: string, location: string) =>
    ({ courseCode: code, section, location, startAt: kyiv(from), endAt: kyiv(to) });
  assert.deepEqual(scheduleByDay([
    c('2026-10-28T13:30:00', '2026-10-28T14:50:00', 'ECON100', 'P4', 'M. Shpaka 3, 2.15.2'),
    c('2026-10-27T11:30:00', '2026-10-27T12:50:00', 'ECON100', 'P6', 'M. Shpaka 3, 4.08 TAS Group Classroom'),
    c('2026-10-27T18:00:00', '2026-10-27T19:20:00', 'ENG111', 'P11', 'Y. Myroshnychenko 6/11, F2'),
  ], 'uk'), [
    { day: 'Вт 27.10', classes: ['11:30–12:50  ECON100 [P6] · M. Shpaka 3, 4.08', '18:00–19:20  ENG111 [P11] · Y. Myroshnychenko 6/11, F2'] },
    { day: 'Ср 28.10', classes: ['13:30–14:50  ECON100 [P4] · M. Shpaka 3, 2.15.2'] },
  ]);
});

test('first digest is today when its hour is still ahead', () => {
  assert.match(onboardedText('uk', 20, 9), /сьогодні о 20:00/);
  assert.match(onboardedText('uk', 8, 21), /завтра о 08:00/);
  assert.match(onboardedText('uk', -1, 9), /вимкнено/);
});

test('"> " lines from the assistant become one collapsible quote', () => {
  const html = markdownToTelegramHtml('Здати 2 речі.\n> перша\n> друга');
  assert.equal(html, 'Здати 2 речі.\n<blockquote expandable>перша\nдруга</blockquote>');
});
