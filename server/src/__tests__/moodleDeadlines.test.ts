import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isReadOnly } from '../services/moodleGradesService.js';
import { eventExternalId, goneRows, quizGrade, toDeadline, type WsEvent, type WsQuiz } from '../utils/moodleWs.js';

const DUE = 1794175140; // 2026-11-08 23:59 Kyiv
const assignEvent: WsEvent = { id: 44013, name: 'Строк Essay Submission спливає', courseid: 4315, modulename: 'assign', instance: 16313, eventtype: 'due', timestart: DUE };
const assign = { id: 16313, cmid: 140543, duedate: DUE, cutoffdate: 0 };
const quiz: WsQuiz = { id: 9081, coursemodule: 141000, timeopen: 1793354400, timeclose: DUE, attempts: 2, grade: 10, sumgrades: 20, decimalpoints: 2 };
const quizEvent: WsEvent = { id: 44022, name: 'Week 9 closes', courseid: 4345, modulename: 'quiz', instance: 9081, eventtype: 'close', timestart: DUE };

test('only reading: submitting, uploading, messaging, posting and quizzes are refused', () => {
  for (const fn of ['core_calendar_get_calendar_events', 'mod_assign_get_assignments', 'mod_assign_get_submission_status', 'mod_quiz_get_quizzes_by_courses', 'mod_quiz_get_user_attempts']) {
    assert.equal(isReadOnly(fn), true, fn);
  }
  for (const fn of ['mod_assign_save_submission', 'mod_assign_submit_for_grading', 'core_files_upload', 'core_message_send_instant_messages',
    'core_message_get_messages', 'mod_forum_add_discussion', 'mod_quiz_start_attempt', 'mod_quiz_process_attempt',
    'core_completion_update_activity_completion_status_manually', 'core_user_update_users', 'core_calendar_create_calendar_events']) {
    assert.equal(isReadOnly(fn), false, fn);
  }
});

test('the event id is the calendar export\'s UID, so the same row is updated, not duplicated', () => {
  assert.equal(eventExternalId(39768), '39768@teaching.kse.org.ua');
  assert.equal(toDeadline(assignEvent, { assign })!.externalId, '44013@teaching.kse.org.ua');
});

test('an assignment Moodle marks submitted is done; "new" or no status is not', () => {
  const submitted = toDeadline(assignEvent, { assign, status: { lastattempt: { submission: { status: 'submitted', timemodified: DUE - 3600 } } } })!;
  assert.equal(submitted.type, 'assignment');
  assert.equal(submitted.submittedAt?.getTime(), (DUE - 3600) * 1000);
  assert.equal(submitted.sourceUrl, 'https://teaching.kse.org.ua/mod/assign/view.php?id=140543');
  assert.equal(toDeadline(assignEvent, { assign, status: { lastattempt: { submission: { status: 'new', timemodified: DUE - 9000 } } } })!.submittedAt, null);
  // A draft counts as not handed in: only "submitted" or not (owner's call)
  assert.equal(toDeadline(assignEvent, { assign, status: { lastattempt: { submission: { status: 'draft', timemodified: DUE - 9000 } } } })!.submittedAt, null);
  assert.equal(toDeadline(assignEvent, { assign })!.submittedAt, null);
  // A group assignment keeps its status in teamsubmission
  assert.ok(toDeadline(assignEvent, { assign, status: { lastattempt: { teamsubmission: { status: 'submitted', timemodified: DUE - 60 } } } })!.submittedAt);
});

test('an extension moves the due date; the cut-off and the grade come along', () => {
  const ext = DUE + 2 * 86_400;
  const d = toDeadline(assignEvent, {
    assign: { ...assign, cutoffdate: DUE + 86_400 },
    status: { lastattempt: { extensionduedate: ext }, feedback: { gradefordisplay: '<span>17,50</span> / 20,00' } },
  })!;
  assert.equal(d.dueDate.getTime(), ext * 1000);
  assert.equal(d.moodle.extendedFrom, new Date(DUE * 1000).toISOString());
  assert.equal(d.moodle.cutoff, new Date((DUE + 86_400) * 1000).toISOString());
  assert.equal(d.moodle.grade, '17,50 / 20,00');
  // No extension: the event's own date
  assert.equal(toDeadline(assignEvent, { assign, status: { lastattempt: { extensionduedate: null } } })!.dueDate.getTime(), DUE * 1000);
});

test('a quiz with a finished attempt is done; attempts and the best grade on the quiz scale', () => {
  const d = toDeadline(quizEvent, { quiz, attempts: [
    { state: 'finished', sumgrades: 14, timefinish: DUE - 7200 },
    { state: 'inprogress', sumgrades: null, timefinish: 0 },
  ] })!;
  assert.equal(d.type, 'quiz');
  assert.equal(d.submittedAt?.getTime(), (DUE - 7200) * 1000);
  assert.deepEqual(d.moodle, { opensAt: new Date(quiz.timeopen * 1000).toISOString(), attemptsUsed: 1, attemptsAllowed: 2, grade: '7 / 10' });
  const none = toDeadline(quizEvent, { quiz, attempts: [{ state: 'inprogress', sumgrades: null, timefinish: 0 }] })!;
  assert.equal(none.submittedAt, null);
  assert.equal(none.moodle.attemptsUsed, 0);
});

test('quiz grades read like Moodle: comma, no trailing zeros, hidden marks give nothing', () => {
  assert.equal(quizGrade({ ...quiz, grade: 1, sumgrades: 29 }, [{ state: 'finished', sumgrades: 29, timefinish: 1 }, { state: 'finished', sumgrades: 0, timefinish: 2 }]), '1 / 1');
  assert.equal(quizGrade({ ...quiz, grade: 10, sumgrades: 33 }, [{ state: 'finished', sumgrades: 31.3617, timefinish: 1 }]), '9,5 / 10');
  assert.equal(quizGrade(quiz, [{ state: 'finished', sumgrades: null, timefinish: 1 }]), null);
});

test('"opens" events are not deadlines; course events are plain events', () => {
  assert.equal(toDeadline({ ...quizEvent, id: 44021, name: 'Week 9 opens', eventtype: 'open' }), null);
  const ev = toDeadline({ id: 5, name: 'Guest lecture', courseid: 4100, modulename: null, instance: null, eventtype: 'course', timestart: DUE })!;
  assert.equal(ev.type, 'event');
  assert.equal(ev.submittedAt, null);
  assert.match(ev.sourceUrl, /calendar\/view\.php\?view=day&time=1794175140#event_5$/);
});

test('rows Moodle no longer has: future ones go, past ones stay, nothing goes on an empty answer', () => {
  const now = new Date(DUE * 1000);
  const rows = [
    { id: 1, externalId: '1@teaching.kse.org.ua', dueDate: new Date(now.getTime() + 3_600_000) },
    { id: 2, externalId: '2@teaching.kse.org.ua', dueDate: new Date(now.getTime() + 3_600_000) },
    { id: 3, externalId: '3@teaching.kse.org.ua', dueDate: new Date(now.getTime() - 3_600_000) },
  ];
  assert.deepEqual(goneRows(rows, new Set(['1@teaching.kse.org.ua']), now).map((r) => r.id), [2]);
  assert.deepEqual(goneRows(rows, new Set(), now), []);
});
