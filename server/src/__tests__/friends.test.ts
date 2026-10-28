import { test } from 'node:test';
import assert from 'node:assert/strict';
import { requestAction } from '../utils/friends.js';
import { signInvite, verifyInvite } from '../utils/crypto.js';

const pair = (requesterId: number, addresseeId: number, status: 'pending' | 'accepted' | 'declined') => ({ requesterId, addresseeId, status });

test('a first request creates a pending one', () => {
  assert.equal(requestAction(null, 1), 'create');
});

test('asking back someone who already asked makes you friends at once', () => {
  assert.equal(requestAction(pair(2, 1, 'pending'), 1), 'accept');
});

test('a "no" is not asked twice, and asking again changes nothing', () => {
  assert.equal(requestAction(pair(1, 2, 'declined'), 1), 'already_requested');
  assert.equal(requestAction(pair(1, 2, 'pending'), 1), 'already_requested');
  // …but the one who declined can still change their mind
  assert.equal(requestAction(pair(1, 2, 'declined'), 2), 'accept');
});

test('friends stay friends', () => {
  assert.equal(requestAction(pair(1, 2, 'accepted'), 2), 'already_friends');
});

test('invite codes fit a Telegram start parameter and can\'t be forged', () => {
  process.env.TOKEN_ENC_KEY ??= '0'.repeat(64);
  const code = signInvite(1234);
  assert.match(`inv_${code}`, /^[A-Za-z0-9_-]{1,64}$/);
  assert.equal(verifyInvite(code), 1234);
  assert.equal(verifyInvite(code.replace(/^[^_]+/, (1235).toString(36))), null);
  assert.equal(verifyInvite('garbage'), null);
});
