import { test } from 'node:test';
import assert from 'node:assert/strict';
import { eventSourceKey, ingestSchema, laterTs } from '../utils/slackIngest.js';

const channel = {
  channelId: 'G07ABCDE12', channelName: '#MATH101-pr8-autumn-2026', isPrivate: true, team: 'kse-students',
  fromTs: '1761700000.000100', toTs: '1761786400.000200',
  summary: 'Квіз перенесли на пʼятницю',
  items: [{ kind: 'change', text: 'Квіз — пт 31.10, 10:00', permalink: 'https://kse-students.slack.com/archives/G07ABCDE12/p1761786400000200' }],
  events: [],
};

test('the task\'s JSON is read as is; the channel name is normalised', () => {
  const { channels: [c] } = ingestSchema.parse({ channels: [channel] });
  assert.equal(c.channelName, 'math101-pr8-autumn-2026');
  assert.equal(c.items[0].dueAt, undefined);
  assert.deepEqual(c.events, []);
  // nothing important in the channel: summary null is fine
  assert.equal(ingestSchema.parse({ channels: [{ ...channel, summary: null, items: [] }] }).channels[0].summary, null);
});

test('every point must link to the original Slack message', () => {
  const noLink = { ...channel, items: [{ kind: 'other', text: 'щось', permalink: 'https://example.com/x' }] };
  assert.throws(() => ingestSchema.parse({ channels: [noLink] }));
  assert.throws(() => ingestSchema.parse({ channels: [{ ...channel, channelId: 'D0DIRECT1' }] }), 'DMs are not channels');
  assert.throws(() => ingestSchema.parse({ channels: [{ ...channel, toTs: 'yesterday' }] }));
});

test('cursors move forward only, compared as numbers', () => {
  assert.equal(laterTs(null, '1761786400.000200'), '1761786400.000200');
  assert.equal(laterTs('1761786400.000200', '1761700000.9'), '1761786400.000200');
  assert.equal(laterTs('999999999.1', '1000000000.1'), '1000000000.1');
});

test('one event per original message', () => {
  const link = 'https://kse-students.slack.com/archives/C0EVENT001/p1761786400000200';
  assert.equal(eventSourceKey('C0EVENT001', link), 'slack:C0EVENT001:p1761786400000200');
  assert.equal(eventSourceKey('C0EVENT001', `${link}?thread_ts=1761786400.000200`), 'slack:C0EVENT001:p1761786400000200');
});

test('the task endpoints need the task secret; the student feed needs Telegram auth', async () => {
  process.env.SLACK_INGEST_SECRET = 'test-secret';
  const { default: app } = await import('../index.js');
  assert.equal((await app.request('/api/slack/cursors')).status, 401);
  assert.equal((await app.request('/api/slack/ingest', { method: 'POST', headers: { Authorization: 'Bearer wrong' }, body: '{}' })).status, 401);
  const bad = await app.request('/api/slack/ingest', {
    method: 'POST', headers: { Authorization: 'Bearer test-secret', 'Content-Type': 'application/json' }, body: JSON.stringify({ channels: [{ channelId: 'x' }] }),
  });
  assert.equal(bad.status, 400);
  assert.equal((await app.request('/api/slack/feed')).status, 401);
});
