import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'crypto';
import { MOODLE_URL, cleanGrade, courseCodeOf, launchUrl, parseLaunchLink } from '../utils/moodleToken.js';
import { sameKsePerson } from '../services/moodleGradesService.js';

const passport = 'abc.123.def';
const siteId = createHash('md5').update(MOODLE_URL + passport).digest('hex');
const token = '0123456789abcdef0123456789abcdef';
const link = (s: string) => `moodlemobile://token=${Buffer.from(s).toString('base64')}`;

test('the sign-in page link asks for the official app service and shows the link instead of jumping', () => {
  const u = new URL(launchUrl(passport));
  assert.equal(u.origin + u.pathname, 'https://teaching.kse.org.ua/admin/tool/mobile/launch.php');
  assert.equal(u.searchParams.get('service'), 'moodle_mobile_app');
  assert.equal(u.searchParams.get('confirmed'), '1');
  assert.equal(u.searchParams.get('passport'), passport);
  // straight through the Google sign-in: an already open session gets no token
  assert.equal(u.searchParams.get('oauthsso'), '2');
});

test('the copied link gives the token; the private token is dropped', () => {
  assert.deepEqual(parseLaunchLink(link(`${siteId}:::${token}:::privatesecret`), passport), { token });
  assert.deepEqual(parseLaunchLink(`  ${link(`${siteId}:::${token}`)}  `, passport), { token });
});

test('a link from another sign-in or another Moodle is refused', () => {
  assert.deepEqual(parseLaunchLink(link(`${siteId}:::${token}`), 'another-passport'), { error: 'other_site' });
  assert.deepEqual(parseLaunchLink(link(`${siteId}:::not-a-token`), passport), { error: 'bad_token' });
  assert.deepEqual(parseLaunchLink('https://teaching.kse.org.ua/', passport), { error: 'no_token' });
});

test('only the same KSE person: Moodle username vs the Google email', () => {
  assert.equal(sameKsePerson('valerii.pletmintsev.26@kse.org.ua', 'Valerii.Pletmintsev.26@kse.org.ua'), true);
  assert.equal(sameKsePerson('valerii.pletmintsev.26', 'valerii.pletmintsev.26@kse.org.ua'), true);
  assert.equal(sameKsePerson('someone.else.26@kse.org.ua', 'valerii.pletmintsev.26@kse.org.ua'), false);
});

test('grades read as Moodle shows them; "-" is "not graded yet"', () => {
  assert.equal(cleanGrade('<span>87,50</span>'), '87,50');
  assert.equal(cleanGrade('-'), null);
  assert.equal(cleanGrade(''), null);
  assert.equal(courseCodeOf('ECON100-L1-autumn', 'Principles of Economics'), 'ECON100');
  assert.equal(courseCodeOf(null, 'General / University'), null);
});

test('grades are owner-only for now', async () => {
  const { default: app } = await import('../index.js');
  assert.equal((await app.request('/api/moodle/grades')).status, 401);
});
