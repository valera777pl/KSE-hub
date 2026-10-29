import { test } from 'node:test';
import assert from 'node:assert/strict';
import { archiveChannelIds, channelNamesIn, channelScope } from '../utils/slackLinks.js';
import { channelVisible, type StudentFacts } from '../services/slackAccess.js';

const known = {
  courses: [
    { courseCode: 'MATH111', title: 'Introduction to Calculus (BE, EBD)' },
    { courseCode: 'MATH101', title: 'Introduction to Mathematics' },
    { courseCode: 'ECON100', title: 'Principles of Economics (BE)' },
  ],
  programs: ['BE', 'EBD'],
};

test('a channel name tells the course and the section', () => {
  assert.deepEqual(channelScope('math101-pr8-autumn-2026', known), { kind: 'course', courseCode: 'MATH101', section: 'P8' });
  assert.deepEqual(channelScope('math101-autumn-2026', known), { kind: 'course', courseCode: 'MATH101', section: null });
  assert.deepEqual(channelScope('eng111-pr11-autumn-2026', known), { kind: 'course', courseCode: 'ENG111', section: 'P11' });
  assert.deepEqual(channelScope('kse101-l3', known), { kind: 'course', courseCode: 'KSE101', section: 'L3' });
});

test('a course written out in words matches the course title', () => {
  assert.deepEqual(channelScope('intro_to_calculus-pr6-autumn-2026', known), { kind: 'course', courseCode: 'MATH111', section: 'P6' });
  assert.deepEqual(channelScope('principles_of_econ-pr6-autumn-2026', known), { kind: 'course', courseCode: 'ECON100', section: 'P6' });
  // "intro" fits two courses — not guessed
  assert.equal(channelScope('intro_to-pr6', known), null);
});

test('a cohort channel: programme and graduation year → entry year', () => {
  assert.deepEqual(channelScope('be30', known), { kind: 'cohort', program: 'BE', cohortYear: 2026 });
  assert.equal(channelScope('kse-ba30', known), null);
  assert.equal(channelScope('ba-kse-30-autumn-2026', known), null);
  assert.equal(channelScope('general', known), null);
});

test('Slack emails prove membership', () => {
  const body = 'New message in #math101-pr8-autumn-2026 https://kse-students.slack.com/archives/C07ABCDE12/p1 https://kse-students.slack.com/archives/G0BBBBBBB2/p2';
  assert.deepEqual(archiveChannelIds(body), ['C07ABCDE12', 'G0BBBBBBB2']);
  assert.deepEqual(channelNamesIn('New message in #MATH101-pr8-autumn-2026'), ['math101-pr8-autumn-2026']);
});

const student = (over: Partial<StudentFacts> = {}): StudentFacts => ({
  sections: [{ courseCode: 'MATH101', section: 'P8' }, { courseCode: 'ECON100', section: 'L1' }],
  program: 'BE', entryYear: 2026, mailChannelIds: new Set(), mailChannelNames: new Set(), ...over,
});
const channel = (over: Partial<Parameters<typeof channelVisible>[0]> = {}) => ({
  channelId: 'G0PRIVATE1', name: 'math101-pr8-autumn-2026', isPrivate: true, status: 'active' as const,
  courseCode: 'MATH101', section: 'P8', program: null, cohortYear: null, ...over,
});

test('same section sees the private channel; another section does not', () => {
  assert.equal(channelVisible(channel(), student()), true);
  assert.equal(channelVisible(channel({ section: 'P7' }), student()), false);
  assert.equal(channelVisible(channel({ section: 'Р8' }), student()), true); // Cyrillic Р
});

test('a channel for the whole course: any section of it', () => {
  assert.equal(channelVisible(channel({ courseCode: 'ECON100', section: null }), student()), true);
  assert.equal(channelVisible(channel({ courseCode: 'MATH111', section: null }), student()), false);
});

test('notification emails from the channel are enough', () => {
  const stranger = student({ sections: [] });
  assert.equal(channelVisible(channel(), stranger), false);
  assert.equal(channelVisible(channel(), student({ sections: [], mailChannelIds: new Set(['G0PRIVATE1']) })), true);
  assert.equal(channelVisible(channel(), student({ sections: [], mailChannelNames: new Set(['math101-pr8-autumn-2026']) })), true);
});

test('cohort channels: same programme and entry year', () => {
  const be30 = channel({ name: 'be30', courseCode: null, section: null, program: 'BE', cohortYear: 2026 });
  assert.equal(channelVisible(be30, student()), true);
  assert.equal(channelVisible(be30, student({ entryYear: 2025 })), false);
  assert.equal(channelVisible(be30, student({ program: 'EBD' })), false);
  // the whole cohort, any programme
  assert.equal(channelVisible({ ...be30, program: null }, student({ program: 'EBD' })), true);
});

test('pending and hidden: nobody, not even with emails from it', () => {
  const proof = student({ mailChannelIds: new Set(['G0PRIVATE1']) });
  assert.equal(channelVisible(channel({ status: 'pending', courseCode: null, section: null }), proof), false);
  assert.equal(channelVisible(channel({ status: 'hidden' }), proof), false);
  assert.equal(channelVisible(channel({ status: 'pending', isPrivate: false }), student()), false);
});

test('an open channel: everyone', () => {
  assert.equal(channelVisible(channel({ isPrivate: false, name: 'general', courseCode: null, section: null }), student({ sections: [], entryYear: null })), true);
});

test('a private channel with no course or cohort: only those with emails from it', () => {
  const loose = channel({ courseCode: null, section: null });
  assert.equal(channelVisible(loose, student()), false);
  assert.equal(channelVisible(loose, student({ mailChannelIds: new Set(['G0PRIVATE1']) })), true);
});
