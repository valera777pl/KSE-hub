import { test } from 'node:test';
import assert from 'node:assert/strict';
import { activityName, courseCodeIn, groupIn, isOtherGroup, matchAssignment, parseMoodleMail, practiceGroups, visibility } from '../utils/moodleGroups.js';

const mine = practiceGroups([
  { courseCode: 'MATH101', section: 'P8' },
  { courseCode: 'MATH101', section: 'L3' },
  { courseCode: 'ECON100', section: 'L1' },
]);

test('practice sections become group numbers, lectures are ignored', () => {
  assert.deepEqual([...mine], [['MATH101', [8]]]);
  assert.deepEqual([...practiceGroups([{ courseCode: 'ENG111', section: 'P08' }])], [['ENG111', [8]]]);
});

test('"Група N" / "Group N" and the course code are read from Moodle titles', () => {
  assert.equal(groupIn('(MATH101 (2026-2027)-Тест) Квіз 5 · Заняття 12 · Група 7 закрито'), 7);
  assert.equal(groupIn('Quiz 5 · Group 12 closes'), 12);
  assert.equal(groupIn('Homework 1 is due'), null);
  assert.equal(courseCodeIn('MATH101 (2026-2027)-Тест'), 'MATH101');
  assert.equal(courseCodeIn('General / University'), null);
});

test('another group of my practice course is hidden, my own and unknown courses are not', () => {
  const t = (n: number) => `Квіз 5 · Заняття 12 · Група ${n} закривається`;
  assert.equal(isOtherGroup(t(7), 'MATH101 (2026-2027)-Тест', mine), true);
  assert.equal(isOtherGroup(t(8), 'MATH101 (2026-2027)-Тест', mine), false);
  // No [P…] for ECON100 in my schedule: can't tell, show everything
  assert.equal(isOtherGroup(t(7), 'ECON100 Principles', mine), false);
  // No "Група N" in the title
  assert.equal(isOtherGroup('Homework 1 is due', 'MATH101', mine), false);
});

test('the rule is per student: P7 sees group 7, P8 sees group 8', () => {
  const p7 = practiceGroups([{ courseCode: 'MATH101', section: 'P7' }]);
  const title = 'Квіз 5 · Група 7 закривається';
  assert.equal(isOtherGroup(title, 'MATH101', p7), false);
  assert.equal(isOtherGroup(title, 'MATH101', mine), true);
});

test('activity name drops the course prefix and the "closes / закрито" suffix', () => {
  assert.equal(activityName('(MATH101 (2026-2027)-Тест) Квіз 5 · Заняття 12 · Група 8 закрито'), 'квіз 5 · заняття 12 · група 8');
  assert.equal(activityName('Квіз 5 · Заняття 12 · Група 8 closes'), 'квіз 5 · заняття 12 · група 8');
  assert.equal(activityName("Homework 1 is due"), 'homework 1');
});

test('visibility: other groups, "opens", no due date and closes/закрито duplicates are hidden', () => {
  const due = new Date('2026-10-30T20:59:00Z');
  const rows = [
    { id: 1, title: 'Квіз 5 · Заняття 12 · Група 8 закривається', courseName: 'MATH101 (2026-2027)-Тест', dueDate: due },
    { id: 2, title: 'Квіз 5 · Заняття 12 · Група 8 closes', courseName: 'MATH101 (2026-2027)-Тест', dueDate: due },
    { id: 3, title: 'Квіз 5 · Заняття 12 · Група 7 закривається', courseName: 'MATH101 (2026-2027)-Тест', dueDate: due },
    { id: 4, title: 'Квіз 5 · Заняття 12 · Група 8 відкривається', courseName: 'MATH101 (2026-2027)-Тест', dueDate: new Date('2026-10-28T08:00:00Z') },
    { id: 5, title: 'Debate', courseName: 'ECON100', dueDate: null },
    { id: 6, title: 'Problem set 3 is due', courseName: 'ECON100', dueDate: due },
  ];
  const v = visibility(rows, mine);
  assert.deepEqual([1, 2, 3, 4, 5, 6].map((id) => v.get(id)!.hidden), [false, true, true, true, true, false]);
  assert.equal(v.get(3)!.groupNo, 7);
});

test('receipt and feedback emails, Ukrainian and English', () => {
  const crumbs = 'Привіт!\nMATH111 EBD, BE 30 -> Завдання -> Homework 1\n';
  assert.deepEqual(parseMoodleMail("Ви здали роботу на завдання 'Homework 1'", crumbs), { kind: 'submitted', title: 'Homework 1', courseCode: 'MATH111' });
  assert.deepEqual(parseMoodleMail("Grader AI дав відгук на результати вашої роботи із завдання 'Homework 1'", crumbs), { kind: 'feedback', title: 'Homework 1', courseCode: 'MATH111' });
  assert.equal(parseMoodleMail("You have submitted your assignment submission for 'Essay 2'", '')!.kind, 'submitted');
  assert.equal(parseMoodleMail("Grader AI has posted feedback on your submission for 'Essay 2'", '')!.kind, 'feedback');
  assert.equal(parseMoodleMail('[Moodle-Reminder] Квіз 5 · Група 7', ''), null);
});

test('a receipt finds its assignment by name and course, nearest due date wins', () => {
  const at = new Date('2026-10-27T19:14:00Z');
  const rows = [
    { id: 10, title: 'Homework 1 is due', courseName: 'MATH111 Calculus', dueDate: new Date('2026-10-28T20:59:00Z') },
    { id: 11, title: 'Homework 1 is due', courseName: 'ECON100', dueDate: new Date('2026-10-27T20:59:00Z') },
    { id: 12, title: 'Homework 2 is due', courseName: 'MATH111 Calculus', dueDate: new Date('2026-10-27T20:59:00Z') },
  ];
  assert.equal(matchAssignment({ kind: 'submitted', title: 'Homework 1', courseCode: 'MATH111' }, rows, at), 10);
  assert.equal(matchAssignment({ kind: 'submitted', title: 'Homework 1', courseCode: null }, rows, at), 11);
  assert.equal(matchAssignment({ kind: 'submitted', title: 'Essay', courseCode: null }, rows, at), null);
});

test('Moodle emails from msupport@kse.org.ua are recognised as Moodle', async () => {
  const { detectSource } = await import('../services/gmailService.js');
  assert.equal(detectSource('"Не відповідайте на цей лист (via KSE)" <msupport@kse.org.ua>'), 'moodle');
  assert.equal(detectSource('"Grader AI (via KSE)" <msupport@kse.org.ua>'), 'moodle');
  assert.equal(detectSource('Student Office <so@kse.org.ua>'), 'gmail');
  assert.equal(detectSource('Slack <notification@slack.com>'), 'slack');
});

test('the digest keeps a Moodle section; a receipt is one line without a quote', async () => {
  const { digestText } = await import('../bot/messages.js');
  const text = digestText({
    lang: 'uk', now: new Date('2026-10-28T06:00:00Z'), day: new Date('2026-10-28T06:00:00Z'), classes: [], deadlines: [],
    moodle: [{ subject: "Ви здали роботу на завдання 'Homework 1'", summary: "Ви здали роботу на завдання 'Homework 1'" }],
    mail: [], slack: [],
  })!;
  assert.match(text, /<b>Moodle<\/b>\nВи здали роботу на завдання 'Homework 1'$/);
});
