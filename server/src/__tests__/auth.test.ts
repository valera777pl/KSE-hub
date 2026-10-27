import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'crypto';
import { INIT_DATA_MAX_AGE_S, validateTelegramInitData } from '../utils/telegramHash.js';
import { signState, verifyState } from '../utils/crypto.js';

const BOT = '123:test-token';
const NOW = 1_800_000_000;

/** initData the way Telegram signs it: sorted k=v lines, HMAC keyed by HMAC("WebAppData", token). */
function initData(fields: Record<string, string>, token = BOT) {
  const check = Object.keys(fields).sort().map((k) => `${k}=${fields[k]}`).join('\n');
  const secret = createHmac('sha256', 'WebAppData').update(token).digest();
  const hash = createHmac('sha256', secret).update(check).digest('hex');
  return new URLSearchParams({ ...fields, hash }).toString();
}

const user = JSON.stringify({ id: 42, first_name: 'Олена', photo_url: 'https://t.me/i/u/42.jpg' });

test('fresh initData is valid, including encoded Cyrillic and URLs', () => {
  const r = validateTelegramInitData(initData({ auth_date: String(NOW - 60), query_id: 'AA', user }), BOT, NOW);
  assert.equal(r.valid, true);
  assert.equal(r.user?.id, 42);
});

test('initData stays valid for the session window, then expires', () => {
  const at = (age: number) => initData({ auth_date: String(NOW - age), user });
  assert.equal(validateTelegramInitData(at(30 * 60), BOT, NOW).valid, true); // the old 5-minute limit broke this
  assert.equal(validateTelegramInitData(at(INIT_DATA_MAX_AGE_S + 1), BOT, NOW).valid, false);
});

test('tampered, foreign or incomplete initData is rejected', () => {
  const good = initData({ auth_date: String(NOW), user });
  assert.equal(validateTelegramInitData(good.replace('42', '43'), BOT, NOW).valid, false);
  assert.equal(validateTelegramInitData(initData({ auth_date: String(NOW), user }, '999:other'), BOT, NOW).valid, false);
  assert.equal(validateTelegramInitData(initData({ user }), BOT, NOW).valid, false); // no auth_date
  assert.equal(validateTelegramInitData(initData({ auth_date: String(NOW) }), BOT, NOW).valid, false); // no user
  assert.equal(validateTelegramInitData('', BOT, NOW).valid, false);
});

test('session tokens: only for sessions, expire, and resist tampering', () => {
  process.env.TOKEN_ENC_KEY ??= '0'.repeat(64);
  const session = signState(7, 60, 'session');
  assert.equal(verifyState(session, 'session'), 7);
  assert.equal(verifyState(session, 'admin'), null);
  assert.equal(verifyState(signState(7, 60, 'oauth'), 'session'), null);
  assert.equal(verifyState(signState(7, -1, 'session'), 'session'), null);
  assert.equal(verifyState(session.replace(/^7/, '8'), 'session'), null);
});
