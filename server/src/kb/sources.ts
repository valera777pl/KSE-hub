/**
 * Which public KSE pages go into the assistant's knowledge base (Ukrainian versions).
 * university.kse.ua is read from its sitemap, so new programmes are picked up on the next run.
 */

export const UNIVERSITY_SITEMAP = 'https://university.kse.ua/sitemap_pages.xml';

// Path prefixes worth knowing for a student; everything else (news, events, hackathons) is skipped
export const UNIVERSITY_INCLUDE = [
  '/bakalavrat', '/magistratura', '/postgraduate', '/grants', '/mobility', '/veterans-office',
  '/rectors-office', '/vstypna-kampaniya', '/vdala-oplata', '/nevdala-oplata', '/dokymenty',
  '/teachers', '/new-campus', '/stud-guide-2',
];

export const UNIVERSITY_EXCLUDE = [/^\/en(\/|$)/, /-20\d\d(-\d+)?$/, /events/, /news/, /hack/i, /jam/];

export const EXTRA_PAGES = [
  'https://kse.ua/about/',
  'https://kse.ua/admission-to-kse/',
  'https://kse.ua/contacts/',
  'https://kse.ua/education/',
  'https://kse.ua/leadership/',
  'https://kse.ua/kse-infrastructure/',
  'https://kse.ua/community/',
  'https://kse.ua/documents/test-integrity-policy/',
];
