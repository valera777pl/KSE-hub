import { test } from 'node:test';
import assert from 'node:assert/strict';
import { courseFromChannel, slackChannels } from '../utils/slackLinks.js';
import { slackUrl } from '../services/courseService.js';

test('course channel names become course codes', () => {
  assert.equal(courseFromChannel('math101-fall26'), 'MATH101');
  assert.equal(courseFromChannel('econ_100'), 'ECON100');
  assert.equal(courseFromChannel('general'), null);
  assert.equal(courseFromChannel('random-2026'), null);
});

test('one channel link and one course channel name in a Slack email → that course\'s channel', () => {
  const body = 'Олег написав у #math101-fall26:\n«Завтра квіз»\nView in Slack: https://kse-students.slack.com/archives/C07ABCDE12/p1730000000';
  assert.deepEqual(slackChannels('New message in #math101-fall26', body),
    [{ courseCode: 'MATH101', team: 'kse-students', channelId: 'C07ABCDE12', name: 'math101-fall26' }]);
});

test('ambiguous emails (digest of several channels, no link) are ignored', () => {
  const two = 'https://kse.slack.com/archives/C0AAAAAAA1 #math101 https://kse.slack.com/archives/C0BBBBBBB2 #econ100';
  assert.deepEqual(slackChannels('Digest', two), []);
  assert.deepEqual(slackChannels('New message in #math101', 'no link here'), []);
});

test('the course page opens the channel by its web link', () => {
  assert.equal(slackUrl({ slackTeam: 'kse-students', slackChannelId: 'C07ABCDE12' }), 'https://kse-students.slack.com/archives/C07ABCDE12');
  assert.equal(slackUrl({ slackTeam: null, slackChannelId: null }), null);
});
