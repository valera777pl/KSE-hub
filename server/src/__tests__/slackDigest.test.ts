import { test } from 'node:test';
import assert from 'node:assert/strict';
import { slackDigestText } from '../bot/messages.js';
import { QUIET_MS, slackDigestDue } from '../services/slackDigestService.js';

const now = new Date('2026-10-30T07:00:00Z'); // Fri 09:00 Kyiv
const math = {
  name: 'intro_to_calculus-pr6-autumn-2026', courseCode: 'MATH111', section: 'P6', url: 'https://ksestudents.slack.com/archives/C0BU8PC0TD2',
  points: [
    { text: 'Наступного тижня пари онлайн і без квізу', permalink: 'https://ksestudents.slack.com/archives/C0BU8PC0TD2/p1' },
    { text: 'Через тиждень — 2 квізи', permalink: 'https://ksestudents.slack.com/archives/C0BU8PC0TD2/p2' },
  ],
};

test('one message: the day, the course as KSE writes it, the points, a link to the original', () => {
  const text = slackDigestText('uk', now, [math, { name: 'general', courseCode: null, section: null, url: null, points: [{ text: 'Принтер & сканер у Study Room', permalink: 'https://ksestudents.slack.com/archives/C05/p3' }] }])!;
  assert.ok(text.startsWith('<b>Slack · Пʼятниця, 30 жовтня</b>\n\n'));
  assert.match(text, /<b>MATH111 \[P6\]<\/b> · #intro_to_calculus-pr6-autumn-2026\nНаступного тижня пари онлайн і без квізу\nЧерез тиждень — 2 квізи\n<a href="https:\/\/ksestudents\.slack\.com\/archives\/C0BU8PC0TD2\/p1">Відкрити в Slack<\/a>/);
  assert.match(text, /<b>#general<\/b>\nПринтер &amp; сканер у Study Room/);
  assert.doesNotMatch(text, /[\u{1F300}-\u{1FAFF}]/u, 'no emoji');
});

test('at most 3 points per channel; nothing to say → no message', () => {
  const many = { ...math, points: [1, 2, 3, 4, 5].map((n) => ({ text: `Пункт ${n}`, permalink: `https://ksestudents.slack.com/archives/C0/p${n}` })) };
  const text = slackDigestText('en', now, [many])!;
  assert.match(text, /Пункт 3/);
  assert.doesNotMatch(text, /Пункт 4/);
  assert.match(text, /Open in Slack/);
  assert.equal(slackDigestText('uk', now, [{ ...math, points: [] }]), null);
});

test('it goes at the student\'s slot: 09:00 morning, 20:00 evening', () => {
  assert.equal(slackDigestDue({ hour: 9, slots: ['morning'], lastPublishedAt: null, now }), 'slot');
  assert.equal(slackDigestDue({ hour: 20, slots: ['morning', 'evening'], lastPublishedAt: null, now }), 'slot');
  assert.equal(slackDigestDue({ hour: 9, slots: ['evening'], lastPublishedAt: null, now }), null);
});

test('after the owner publishes by hand: once things are quiet for 10 min, by day only', () => {
  const ago = (ms: number) => new Date(now.getTime() - ms);
  assert.equal(slackDigestDue({ hour: 14, slots: ['evening'], lastPublishedAt: ago(QUIET_MS - 60_000), now }), null, 'still publishing');
  assert.equal(slackDigestDue({ hour: 14, slots: ['evening'], lastPublishedAt: ago(QUIET_MS + 60_000), now }), 'review');
  assert.equal(slackDigestDue({ hour: 14, slots: ['evening'], lastPublishedAt: ago(3 * 3_600_000), now }), null, 'long ago: waits for the slot');
  assert.equal(slackDigestDue({ hour: 23, slots: ['evening'], lastPublishedAt: ago(QUIET_MS + 60_000), now }), null, 'not at night');
});
