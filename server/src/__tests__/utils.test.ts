import { test } from 'node:test';
import assert from 'node:assert/strict';
import { toLatin } from '../utils/translit.js';
import { kyivDayStart, kyivWeekStart, kyivWeekday } from '../utils/kyivTime.js';
import { chunkHtml } from '../bot/send.js';
import { markdownToTelegramHtml } from '../bot/bot.js';
import { isClassScheduleNotice, normalize } from '../services/gmailService.js';
import { nameFromEmail } from '../services/scheduleService.js';
import { retryDelayMs } from '../ai/client.js';
import { signState, verifyState } from '../utils/crypto.js';

test('Ukrainian surnames transliterate like KSE emails', () => {
  assert.equal(toLatin('Плетмінцев'), 'pletmintsev');
  assert.equal(toLatin('Валерій'), 'valerii');
  assert.equal(toLatin('Юлія Яременко'), 'yuliia yaremenko');
  assert.equal(toLatin('Згурський'), 'zghurskyi');
});

test('name and cohort from a KSE email', () => {
  assert.deepEqual(nameFromEmail('ivan.petrenko-kovalenko.26@kse.org.ua'), { name: 'Ivan Petrenko-Kovalenko', cohort: 2026 });
  assert.deepEqual(nameFromEmail('staff.member@kse.org.ua'), { name: 'Staff Member', cohort: null });
});

test('Kyiv week/day boundaries across the October DST switch', () => {
  assert.equal(kyivWeekStart('2026-10-24').toISOString(), '2026-10-18T21:00:00.000Z'); // Mon 19th, UTC+3
  assert.equal(kyivWeekStart('2026-10-28').toISOString(), '2026-10-25T22:00:00.000Z'); // Mon 26th, UTC+2
  assert.equal(kyivDayStart('2026-10-26').toISOString(), '2026-10-25T22:00:00.000Z');
  assert.equal(kyivWeekday(new Date('2026-10-25T20:00:00Z')), 0); // Sunday evening in Kyiv
});

test('KSE schedule-worker notices are skipped, real invitations kept', () => {
  assert.ok(isClassScheduleNotice('KSE Hub Worker #5 <w@kse.org.ua>', 'Updated invitation: KSE101 How to study'));
  assert.ok(isClassScheduleNotice('Teacher <t@kse.org.ua>', 'Updated invitation with note: ECON100 Principles'));
  assert.ok(!isClassScheduleNotice('Viktoriia <v@kse.org.ua>', 'Запрошення: Polish-Ukrainian Economic Seminar'));
  assert.ok(!isClassScheduleNotice('Study Support <s@kse.org.ua>', 'Компенсація вартості навчання'));
});

test('copies of one mailing normalize to the same text', () => {
  const a = normalize('Dear Ivan,\nThe library is closed on Monday.\nUnsubscribe: https://x.y/1');
  const b = normalize('Dear Olena,\nThe library is closed on Monday.\nUnsubscribe: https://x.y/2');
  assert.equal(a, b);
});

test('long Telegram messages split without breaking tags', () => {
  const body = Array.from({ length: 40 }, (_, i) => `• <b>Лист ${i}</b>\n  ${'текст '.repeat(30)}`).join('\n');
  const chunks = chunkHtml(`<b>Дайджест</b>\n\n${body}`);
  assert.ok(chunks.length > 1);
  for (const c of chunks) {
    assert.ok(c.length <= 4000);
    assert.equal((c.match(/<b>/g) ?? []).length, (c.match(/<\/b>/g) ?? []).length);
  }
});

test('assistant Markdown becomes Telegram HTML', () => {
  assert.equal(
    markdownToTelegramHtml('**Дедлайни:**\n* Есе — *пт*\n- Quiz <3>'),
    '<b>Дедлайни:</b>\n• Есе — <i>пт</i>\n• Quiz &lt;3&gt;'
  );
});

test('Gemini retry delay is read from the error, long waits give up', () => {
  assert.equal(retryDelayMs('"retryDelay": "12s"'), 12_500);
  assert.equal(retryDelayMs('"retryDelay": "39472s"'), null);
});

test('signed links: purpose and expiry are enforced', () => {
  process.env.TOKEN_ENC_KEY ??= '0'.repeat(64);
  const admin = signState(7, 60, 'admin');
  assert.equal(verifyState(admin, 'admin'), 7);
  assert.equal(verifyState(admin, 'oauth'), null);
  assert.equal(verifyState(signState(7, -1, 'admin'), 'admin'), null);
  assert.equal(verifyState(admin.replace(/^7/, '8'), 'admin'), null);
});

test('booking quota day is the Kyiv day, including the 25-hour DST day', async () => {
  const { getDayBounds } = await import('../utils/dateUtils.js');
  const late = getDayBounds(new Date('2026-10-23T22:30:00Z')); // 01:30 on the 24th in Kyiv
  assert.equal(late.start.toISOString(), '2026-10-23T21:00:00.000Z');
  const dst = getDayBounds(new Date('2026-10-25T12:00:00Z'));
  assert.equal(dst.end.getTime() - dst.start.getTime() + 1, 25 * 3_600_000);
});

test('midnight in Kyiv on the DST-switch days', () => {
  assert.equal(kyivDayStart('2026-10-25').toISOString(), '2026-10-24T21:00:00.000Z'); // still +03 at 00:00
  assert.equal(kyivDayStart('2026-03-29').toISOString(), '2026-03-28T22:00:00.000Z'); // still +02 at 00:00
});
