import { test } from 'node:test';
import assert from 'node:assert/strict';
import { isReadOnly } from '../services/moodleGradesService.js';
import { courseByCode, courseMaterials, type WsSection } from '../utils/moodleWs.js';
import { courseCodeIn } from '../utils/moodleGroups.js';
import { CLIENT_EVENTS } from '../services/analyticsService.js';

// Short names as KSE Moodle has them
const courses = [
  { id: 4316, shortname: 'MATH111 EBD, BE 30', fullname: 'Introduction to Calculus' },
  { id: 4345, shortname: 'ENG111 Англійська для навчання та роботи I (BE, EBD) English for Professional and Study Purposes I ', fullname: 'ENG111' },
  { id: 4315, shortname: 'ECON100 BE, EBD 30', fullname: 'Principles of Economics / Основи економіки BE30, EBD30' },
  { id: 4198, shortname: 'MATH101 (2026-2027)', fullname: 'MATH101' },
];

test('the course page reads the outline, still nothing that writes', () => {
  assert.equal(isReadOnly('core_course_get_contents'), true);
  for (const fn of ['core_course_edit_module', 'core_course_update_courses', 'mod_resource_view_resource', 'core_files_upload']) assert.equal(isReadOnly(fn), false, fn);
});

test('a course is found by its code: MATH101 is not MATH111', () => {
  assert.equal(courseByCode(courses, 'MATH101')?.id, 4198);
  assert.equal(courseByCode(courses, 'MATH111')?.id, 4316);
  assert.equal(courseByCode(courses, 'ENG111')?.id, 4345);
  assert.equal(courseByCode(courses, 'POL101'), null);
  // and the course page's own lookup reads the same names
  assert.equal(courseCodeIn(courses[1].shortname.trim()), 'ENG111');
});

test('materials: what the student can open, section by section, links to Moodle pages only', () => {
  const outline: WsSection[] = [
    { id: 1, name: 'Загальне', section: 0, modules: [{ id: 126328, name: 'Оголошення', modname: 'forum' }] },
    { id: 2, name: 'Study Materials ', section: 1, modules: [
      { id: 134504, name: 'Mankiw Principles of Economics', modname: 'resource' },
      { id: 9, name: 'Read this first', modname: 'label' },
      { id: 10, name: 'Hidden draft', modname: 'resource', uservisible: false },
      { id: 135076, name: '🧑‍🏫 (L) 01.10.2026 Online EC', modname: 'url' },
    ] },
    { id: 3, name: 'Only labels', section: 2, modules: [{ id: 11, name: 'Week intro', modname: 'label' }] },
    { id: 4, name: 'Closed section', section: 3, uservisible: false, modules: [{ id: 12, name: 'Exam', modname: 'quiz' }] },
  ];
  const out = courseMaterials(outline);
  assert.deepEqual(out.map((s) => s.name), ['Загальне', 'Study Materials']);
  assert.deepEqual(out[1].items, [
    { id: 134504, name: 'Mankiw Principles of Economics', kind: 'resource', url: 'https://teaching.kse.org.ua/mod/resource/view.php?id=134504' },
    { id: 135076, name: '(L) 01.10.2026 Online EC', kind: 'url', url: 'https://teaching.kse.org.ua/mod/url/view.php?id=135076' },
  ]);
  for (const s of out) for (const m of s.items) assert.doesNotMatch(m.url, /token|pluginfile/);
});

test('the course list and the course page report their taps', () => {
  for (const e of ['courses.open', 'course.material_open', 'deadline.grade_open', 'course.open']) assert.match(e, CLIENT_EVENTS);
  assert.doesNotMatch('course.delete', CLIENT_EVENTS);
});
