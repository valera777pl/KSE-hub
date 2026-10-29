/*
 * Dev-only stand-in for Telegram and the API: http://localhost:5173/?mock=1&theme=dark
 *   &theme=light|dark   Telegram theme (default: system)
 *   &now=11:45          pretend it's this time today (default 11:45, so a class is in progress)
 *   &state=empty|error  every list empty / every request fails with a server error
 *   &state=stale        offline: every request fails, screens show what the last normal visit cached
 *   &state=auth         sign-in expired: the session can't be renewed
 * In the console, tgScheme('dark') fires Telegram's themeChanged.
 *   &onboarding=1       a student who hasn't finished sign-up
 *   &startapp=day_2026-10-27   deep link, as from a bot button
 * Loaded from main.tsx behind import.meta.env.DEV, so none of this reaches the production bundle.
 */

const q = new URLSearchParams(location.search);
const scheme: 'light' | 'dark' = (q.get('theme') as 'light' | 'dark') || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light');
const state = q.get('state');
// &step=program jumps straight to that onboarding screen
if (q.get('step')) localStorage.setItem('tgm:onboarding_step', q.get('step')!);
else if (q.get('onboarding')) localStorage.removeItem('tgm:onboarding_step');

/* ─── Clock ─── */
const [nh, nm] = (q.get('now') || '11:45').split(':').map(Number);
const NOW = new Date();
NOW.setHours(nh, nm || 0, 0, 0);
(window as unknown as { __MOCK_NOW__: number }).__MOCK_NOW__ = NOW.getTime();

/* ─── Telegram iOS theme params ─── */
const THEMES = {
  light: {
    bg_color: '#ffffff', secondary_bg_color: '#efeff4', section_bg_color: '#ffffff', text_color: '#000000',
    hint_color: '#8e8e93', subtitle_text_color: '#8e8e93', section_separator_color: '#c8c7cc',
    destructive_text_color: '#ff3b30', link_color: '#007aff', button_color: '#007aff', button_text_color: '#ffffff',
    header_bg_color: '#f8f8f8', bottom_bar_bg_color: '#f8f8f8',
  },
  dark: {
    bg_color: '#000000', secondary_bg_color: '#000000', section_bg_color: '#1c1c1d', text_color: '#ffffff',
    hint_color: '#98989e', subtitle_text_color: '#98989e', section_separator_color: '#3d3d3f',
    destructive_text_color: '#ff453a', link_color: '#3e88f7', button_color: '#3e88f7', button_text_color: '#ffffff',
    header_bg_color: '#1a1a1a', bottom_bar_bg_color: '#1d1d1d',
  },
};

/* ─── Fake Telegram chrome: header with Close/Back, native bottom button ─── */
const HEADER = 56;
const chrome = document.createElement('div');
chrome.innerHTML = `
  <div id="tgm-head" style="position:fixed;top:0;left:0;right:0;height:${HEADER}px;display:flex;align-items:center;justify-content:space-between;padding:0 16px;z-index:9999;font:500 17px -apple-system,system-ui,sans-serif">
    <span id="tgm-left" style="cursor:pointer">Закрити</span>
    <span style="text-align:center;line-height:1.15"><b style="font-weight:600">KSE Hub</b><br><span style="font-size:12px;opacity:.55">мініапп</span></span>
    <span style="width:52px;text-align:right;opacity:.7">•••</span>
  </div>
  <div id="tgm-bottom" style="position:fixed;left:0;right:0;bottom:0;padding:8px 16px 26px;display:none;z-index:9999">
    <button id="tgm-main" style="width:100%;height:50px;border:0;border-radius:12px;font:600 17px -apple-system,system-ui,sans-serif"></button>
  </div>`;
// On <html>, outside <body>: body becomes the web view below, the way Telegram shrinks it
document.documentElement.appendChild(chrome);
const head = chrome.querySelector<HTMLDivElement>('#tgm-head')!;
const left = chrome.querySelector<HTMLSpanElement>('#tgm-left')!;
const bottom = chrome.querySelector<HTMLDivElement>('#tgm-bottom')!;
const mainEl = chrome.querySelector<HTMLButtonElement>('#tgm-main')!;
const theme = THEMES[scheme];
head.style.background = theme.header_bg_color;
head.style.color = theme.text_color;
head.style.borderBottom = `0.5px solid ${theme.section_separator_color}`;
bottom.style.background = theme.bottom_bar_bg_color;

const listeners: Record<string, Set<() => void>> = {};
const emit = (e: string) => listeners[e]?.forEach((cb) => cb());

function viewport() {
  const h = innerHeight - HEADER - (bottom.style.display === 'none' ? 0 : 84);
  app.viewportHeight = app.viewportStableHeight = h;
  document.documentElement.style.setProperty('--tg-viewport-stable-height', `${h}px`);
  // A transform makes body the box that fixed-position sheets anchor to, so they end above the native button
  Object.assign(document.body.style, { marginTop: `${HEADER}px`, height: `${h}px`, minHeight: '0', overflow: 'hidden', transform: 'translateZ(0)' });
  emit('viewportChanged');
}

const mainClicks = new Set<() => void>();
mainEl.onclick = () => mainClicks.forEach((cb) => cb());
const backClicks = new Set<() => void>();
left.onclick = () => { if (left.dataset.back) backClicks.forEach((cb) => cb()); };

const MainButton = {
  text: '', isVisible: false, isActive: true,
  setParams(p: { text?: string; color?: string; text_color?: string; is_active?: boolean; is_visible?: boolean }) {
    if (p.text !== undefined) mainEl.textContent = p.text;
    if (p.color) mainEl.style.background = p.color;
    if (p.text_color) mainEl.style.color = p.text_color;
    if (p.is_active !== undefined) mainEl.disabled = !p.is_active;
    if (p.is_visible !== undefined) (p.is_visible ? MainButton.show() : MainButton.hide());
  },
  show() { bottom.style.display = 'block'; viewport(); },
  hide() { bottom.style.display = 'none'; viewport(); },
  showProgress() { mainEl.style.opacity = '.6'; },
  hideProgress() { mainEl.style.opacity = '1'; },
  onClick(cb: () => void) { mainClicks.add(cb); },
  offClick(cb: () => void) { mainClicks.delete(cb); },
};

const log = (...a: unknown[]) => console.info('[tg-mock]', ...a);

const app = {
  initData: 'mock',
  initDataUnsafe: {
    user: { id: 100500, first_name: 'Валерій', last_name: 'Плетьминцев', username: 'student', language_code: 'uk' },
    start_param: q.get('startapp') || undefined,
  },
  version: '8.0',
  platform: 'ios',
  colorScheme: scheme as 'light' | 'dark',
  themeParams: theme as (typeof THEMES)['light' | 'dark'],
  viewportHeight: 0,
  viewportStableHeight: 0,
  isVersionAtLeast: () => true,
  ready() {}, expand() {}, close() { log('close'); },
  enableClosingConfirmation() {}, disableVerticalSwipes() {},
  onEvent(e: string, cb: () => void) { (listeners[e] ||= new Set()).add(cb); },
  offEvent(e: string, cb: () => void) { listeners[e]?.delete(cb); },
  setHeaderColor(c: string) {
    head.style.background = c;
    // Telegram picks its header text colour to suit; a dark background gets light text
    const [r, g, b] = [1, 3, 5].map((i) => parseInt(c.slice(i, i + 2), 16));
    head.style.color = r * 0.3 + g * 0.59 + b * 0.11 < 128 ? '#ffffff' : '#000000';
  },
  setBackgroundColor(c: string) { document.body.style.background = c; },
  setBottomBarColor(c: string) { bottom.style.background = c; },
  openLink(url: string) { log('openLink', url); window.open(url, '_blank'); },
  openTelegramLink(url: string) { log('openTelegramLink', url); },
  MainButton,
  BackButton: {
    show() { left.textContent = '‹ Назад'; left.dataset.back = '1'; },
    hide() { left.textContent = 'Закрити'; delete left.dataset.back; },
    onClick(cb: () => void) { backClicks.add(cb); },
    offClick(cb: () => void) { backClicks.delete(cb); },
  },
  HapticFeedback: {
    selectionChanged() { log('haptic: selection'); },
    impactOccurred(s: string) { log('haptic:', s); },
    notificationOccurred(t: string) { log('haptic:', t); },
  },
  CloudStorage: {
    getItem(k: string, cb: (e: unknown, v?: string) => void) { cb(null, localStorage.getItem(`tgm:${k}`) ?? ''); },
    setItem(k: string, v: string, cb?: (e: unknown) => void) { localStorage.setItem(`tgm:${k}`, v); cb?.(null); },
  },
};

(window as unknown as { Telegram: { WebApp: typeof app } }).Telegram = { WebApp: app };

/** From the console: tgScheme('dark') — Telegram switched its theme, as the real client would report it. */
(window as unknown as { tgScheme: (s: 'light' | 'dark') => void }).tgScheme = (s) => {
  app.colorScheme = s;
  app.themeParams = THEMES[s];
  emit('themeChanged');
};
addEventListener('resize', viewport);
viewport();

/* ─── Test data. Course codes and rooms are real KSE ones; people and events are made up. ─── */

const DAY = 86_400_000;
const monday = new Date(NOW);
monday.setHours(0, 0, 0, 0);
monday.setTime(monday.getTime() - ((monday.getDay() + 6) % 7) * DAY);
const at = (dayOffset: number, hm: string, weekOffset = 0) => {
  const [h, m] = hm.split(':').map(Number);
  const d = new Date(monday.getTime() + (dayOffset + weekOffset * 7) * DAY);
  d.setHours(h, m, 0, 0);
  return d.toISOString();
};
const iso = (d: Date) => d.toISOString();

const LOC = {
  s305: 'M. Shpaka 3, 3.05 Genesis Growth Classroom',
  s408: 'M. Shpaka 3, 4.08 TAS Group Classroom',
  s2081: 'M. Shpaka 3, 2.08.1 TA Ventures Classroom',
  s2151: 'M. Shpaka 3, 2.15.1 Roy Gartner Memorial Classroom',
  s1082: 'M. Shpaka 3, 1.08.2 Genesis Classroom',
  f3: 'Y. Myroshnychenko 6/11, F3 Classroom',
  online: 'Online',
};

type Ev = { calendarId: number; courseCode: string; section: string; title: string; location: string; day: number; from: string; to: string };
const WEEK: Ev[] = [
  { calendarId: 1, courseCode: 'MATH111', section: 'P6', title: 'Introduction to Calculus (BE, EBD)', location: LOC.s305, day: 0, from: '10:00', to: '11:20' },
  { calendarId: 2, courseCode: 'ECON100', section: 'P6', title: 'Principles of Economics (BE)', location: LOC.s408, day: 0, from: '11:30', to: '12:50' },
  { calendarId: 3, courseCode: 'KSE101', section: 'L3', title: 'How to study at KSE (BE, EBD, SE)', location: LOC.s2081, day: 0, from: '15:00', to: '16:20' },
  { calendarId: 4, courseCode: 'ENG111', section: 'P11', title: 'English for Professional and Study Purposes I (BE, EBD)', location: LOC.f3, day: 0, from: '18:00', to: '19:20' },
  { calendarId: 1, courseCode: 'MATH111', section: 'P7', title: 'Introduction to Calculus (BE, EBD)', location: LOC.s2081, day: 1, from: '13:30', to: '14:50' },
  { calendarId: 2, courseCode: 'ECON100', section: 'L1', title: 'Principles of Economics (BE)', location: LOC.s2151, day: 1, from: '15:00', to: '16:20' },
  { calendarId: 5, courseCode: 'MATH101', section: 'P8', title: 'Introduction to Mathematics', location: LOC.s1082, day: 2, from: '11:30', to: '12:50' },
  { calendarId: 4, courseCode: 'ENG111', section: 'P11', title: 'English for Professional and Study Purposes I (BE, EBD)', location: LOC.f3, day: 2, from: '18:00', to: '19:20' },
  { calendarId: 5, courseCode: 'MATH101', section: 'P8', title: 'Introduction to Mathematics', location: LOC.s1082, day: 3, from: '11:30', to: '12:50' },
  { calendarId: 3, courseCode: 'KSE101', section: 'L3', title: 'How to study at KSE (BE, EBD, SE)', location: LOC.s2081, day: 3, from: '15:00', to: '16:20' },
  { calendarId: 1, courseCode: 'MATH111', section: 'P6', title: 'Introduction to Calculus (BE, EBD)', location: LOC.s305, day: 4, from: '10:00', to: '11:20' },
  { calendarId: 3, courseCode: 'KSE101', section: 'L3', title: 'How to study at KSE (BE, EBD, SE)', location: LOC.online, day: 4, from: '11:30', to: '12:50' },
];

function weekEvents(start: string | null, list = WEEK) {
  const offset = start ? Math.round((new Date(`${start}T12:00:00`).getTime() - monday.getTime()) / (7 * DAY)) : 0;
  return list.map((e, i) => ({
    id: i + 1 + offset * 100, calendarId: e.calendarId, courseCode: e.courseCode, section: e.section, title: e.title,
    location: e.location, startAt: at(e.day, e.from, offset), endAt: at(e.day, e.to, offset),
  }));
}

const STUDENTS: { userId: number; name: string; fullName: string; cohort: number; username: string; calendars: number[]; hidden?: boolean }[] = [
  { userId: 2, name: 'Данило Гнатенко', fullName: 'Danylo Hnatenko', cohort: 2026, username: 'dhnatenko', calendars: [1, 2, 4, 6] },
  { userId: 3, name: 'Олена Коваленко', fullName: 'Olena Kovalenko', cohort: 2026, username: 'okoval', calendars: [], hidden: true },
  { userId: 4, name: 'Марко Шевчук', fullName: 'Marko Shevchuk', cohort: 2025, username: 'mshev', calendars: [2, 3, 5] },
];

const user = {
  id: 1, telegramId: 100500, username: 'student', fullName: 'Валерій Плетьминцев', avatarUrl: null,
  moodleToken: null, calendarUrl: 'https://teaching.kse.org.ua/calendar/export_execute.php?mock',
  studentType: 'contract', faculty: null, year: 2026, languagePref: (q.get('lang') === 'en' ? 'en' : 'uk'), digestSources: ['moodle', 'gmail', 'slack'],
  digestHour: 8, scheduleVisible: true, onboardedAt: q.get('onboarding') ? null : iso(new Date(NOW.getTime() - 3 * DAY)),
  notifyScheduleChanges: true, classReminders: true, isAdmin: false, program: 'BE',
  createdAt: iso(new Date(NOW.getTime() - 3 * DAY)), updatedAt: iso(NOW),
};

const hours = (h: number) => iso(new Date(NOW.getTime() + h * 3_600_000));
const DEADLINES = [
  { id: 11, title: 'Problem set 4', courseName: 'ECON100 Principles of Economics', due: hours(20), type: 'assignment' },
  { id: 12, title: 'Quiz 3: Limits', courseName: 'MATH111 Introduction to Calculus', due: hours(46), type: 'quiz' },
  { id: 13, title: 'Essay draft: Study habits', courseName: 'KSE101 How to study at KSE', due: hours(100), type: 'assignment' },
  { id: 14, title: 'Фінальний захист проєктів | KSE Консультант/ка із безбар`єрності', courseName: 'General / University', due: hours(99), type: 'event' },
  { id: 15, title: 'Writing task 2', courseName: 'ENG111 English for Professional and Study Purposes I', due: hours(-30), type: 'assignment' },
  // Handed in yesterday evening (Moodle receipt), Grader AI already replied
  { id: 16, title: 'Homework 1', courseName: 'MATH111 Introduction to Calculus', due: hours(26), type: 'assignment', submittedAt: hours(-14), feedbackAt: hours(-2) },
].map((d) => ({
  assignment: { id: d.id, userId: 1, courseId: null, externalId: null, title: d.title, dueDate: d.due, sourceUrl: 'https://teaching.kse.org.ua/mod/assign/view.php?id=1',
    isCompleted: !!d.submittedAt, type: d.type, createdAt: iso(NOW), submittedAt: d.submittedAt ?? null, feedbackAt: d.feedbackAt ?? null },
  courseName: d.courseName,
}));

const ROOMS = [
  ['Skype Room 1 (2nd floor)', 'skype_room', 4, 2], ['Skype Room 2 (2nd floor)', 'skype_room', 4, 2],
  ['Skype Room 3 (3rd floor)', 'skype_room', 6, 3], ['Skype Room 4 (3rd floor)', 'skype_room', 6, 3],
  ['Silent Box A (2nd floor)', 'silent_box', 1, 2], ['Silent Box B (2nd floor)', 'silent_box', 1, 2], ['Silent Box C (2nd floor)', 'silent_box', 1, 2],
].map(([name, type, capacity, floor], i) => ({ id: i + 1, name, type, capacity, floor, hasDesk: true, hasPower: true, metadata: null }));

// Someone else holds Skype Room 2 for the next 40 minutes, and Room 3 from in 90 minutes
const BOOKINGS: { id: number; roomId: number; userId: number; startTime: string; endTime: string; status: string; createdAt: string }[] = [
  { id: 900, roomId: 2, userId: 7, startTime: iso(new Date(NOW.getTime() - 20 * 60_000)), endTime: iso(new Date(NOW.getTime() + 40 * 60_000)), status: 'active', createdAt: iso(NOW) },
  { id: 901, roomId: 3, userId: 7, startTime: iso(new Date(NOW.getTime() + 90 * 60_000)), endTime: iso(new Date(NOW.getTime() + 150 * 60_000)), status: 'active', createdAt: iso(NOW) },
];
const usedHours = () => BOOKINGS.filter((b) => b.userId === 1 && b.status === 'active').reduce((h, b) => h + (Date.parse(b.endTime) - Date.parse(b.startTime)) / 3_600_000, 0);
function availability(start: number, end: number) {
  return ROOMS.map((r) => {
    const own = BOOKINGS.filter((b) => b.roomId === r.id && b.status === 'active').sort((a, b) => a.startTime.localeCompare(b.startTime));
    const busy = own.some((b) => Date.parse(b.startTime) < end && Date.parse(b.endTime) > start);
    let t = start;
    for (const b of own) if (Date.parse(b.startTime) < t + (end - start) && Date.parse(b.endTime) > t) t = Date.parse(b.endTime);
    // Same as the server: a free room stays free until the next booking that day
    const next = own.find((b) => Date.parse(b.startTime) >= start && new Date(b.startTime).toDateString() === new Date(start).toDateString());
    return { ...r, available: !busy, freeFrom: busy ? iso(new Date(t)) : null, freeUntil: !busy && next ? next.startTime : null };
  });
}

const MAIL = [
  { id: 1, subject: 'Польсько-український економічний семінар', from: 'Viktoriia Shadrina', summary: '29 жовтня, 10:00–15:00, ICU Hall. Потрібна реєстрація.', receivedAt: hours(-5), url: 'https://mail.google.com/' },
  { id: 2, subject: 'Компенсація навчання від Мінветеранів', from: 'Study Support KSE', summary: 'Для контрактників до 23 років, діти захисників і ветеранів. Заявки до 15 листопада.', receivedAt: hours(-20), url: 'https://mail.google.com/' },
];

const OPPS = [
  { id: 1, title: 'Junior Data Analyst (стажування)', company: 'Kyivstar', domain: 'Data', eligibility: 'all', category: 'internship', deadline: hours(24 * 9), url: 'https://example.com', description: 'Аналітика клієнтських даних, SQL і Python. 20 год на тиждень, можна поєднувати з навчанням.', salaryInfo: null, createdAt: iso(NOW), source: 'email', emailUrl: 'https://mail.google.com/', programs: ['BE', 'EBD'], saved: false },
  { id: 2, title: 'Research Assistant', company: 'KSE Institute', domain: 'Research', eligibility: 'all', category: 'research', deadline: hours(24 * 2), url: 'https://example.com', description: 'Допомога в дослідженні ринку праці: збір даних, огляд літератури.', salaryInfo: null, createdAt: iso(NOW), source: 'email', emailUrl: null, programs: [], saved: true },
  { id: 3, title: 'Грант на літню школу економіки', company: 'SDO KSE', domain: 'Education', eligibility: 'grant', category: 'grant', deadline: hours(24 * 20), url: 'https://example.com', description: 'Покриття участі в літній школі для грантистів.', salaryInfo: null, createdAt: iso(NOW), source: 'email', emailUrl: 'https://mail.google.com/', programs: [], saved: false },
  { id: 4, title: 'Software Engineering Intern', company: 'Grammarly', domain: 'IT', eligibility: 'all', category: 'internship', deadline: hours(24 * 14), url: 'https://example.com', description: 'Літнє стажування для студентів SE.', salaryInfo: null, createdAt: iso(NOW), source: 'email', emailUrl: null, programs: ['SE'], saved: false },
];

const STARTUPS = [
  { project: { id: 21, userId: 4, title: 'StudyBuddy', pitch: 'Застосунок, що підбирає партнера для підготовки до іспитів за розкладом і курсами.', problem: 'Важко знайти, з ким вчитися перед сесією.', requiredRoles: ['Frontend', 'Designer'], commitmentLevel: '5–10 год на тиждень', isActive: true, createdAt: iso(NOW), updatedAt: iso(NOW) }, author: { id: 4, name: 'Марко Шевчук' }, myStatus: null },
  { project: { id: 22, userId: 2, title: 'CampusEats', pitch: 'Передзамовлення їжі в кафе кампусу між парами.', problem: null, requiredRoles: ['Backend', 'Marketing'], commitmentLevel: null, isActive: true, createdAt: iso(NOW), updatedAt: iso(NOW) }, author: { id: 2, name: 'Данило Гнатенко' }, myStatus: 'pending' },
];
const DECK = [
  { profile: { id: 31, userId: 3, title: 'Product designer, 2 курс EBD', bio: 'Роблю інтерфейси для студентських проєктів, люблю дослідження користувачів.', skills: ['Figma', 'UX research'], lookingFor: ['Стартап', 'Хакатон'], githubUrl: null, portfolioUrl: null, isActive: true, createdAt: iso(NOW), updatedAt: iso(NOW) }, user: { id: 3, fullName: 'Олена Коваленко', username: 'okoval', avatarUrl: null, faculty: 'EBD', year: 2 } },
];

const ok = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const empty = state === 'empty';

type Handler = (m: RegExpMatchArray, url: URL, body: unknown) => unknown;
const routes: [string, RegExp, Handler][] = [
  ['GET', /^\/users\/me$/, () => ({ user })],
  ['PATCH', /^\/users\/me$/, (_m, _u, b) => ({ user: Object.assign(user, b) })],
  ['POST', /^\/users\/me\/(events|onboarding)$/, () => ({ ok: true })],
  ['GET', /^\/google\/status$/, () => ({ connected: !q.get('onboarding') || q.get('mail') === '1', email: 'valerii.pletmintsev.26@kse.org.ua', needsReconnect: false, lastSyncAt: hours(-0.2) })],
  ['GET', /^\/google\/connect$/, () => ({ url: 'https://accounts.google.com/' })],
  ['GET', /^\/notifications$/, () => ({ notifications: [], unreadCount: 0 })],
  ['GET', /^\/schedule\/week$/, (_m, u) => ({ connected: true, synced: true, events: empty ? [] : weekEvents(u.searchParams.get('start')) })],
  ['POST', /^\/schedule\/refresh$/, () => ({ calendars: 5 })],
  ['GET', /^\/schedule\/search$/, (_m, u) => {
    const s = (u.searchParams.get('q') || '').toLowerCase();
    return { students: s.length < 2 ? [] : STUDENTS.filter((x) => `${x.name} ${x.fullName}`.toLowerCase().includes(s)).map(({ calendars: _c, hidden: _h, ...x }) => ({ ...x, avatarUrl: null })) };
  }],
  ['GET', /^\/schedule\/compare\/(\d+)$/, (m, u) => {
    const st = STUDENTS.find((x) => x.userId === Number(m[1]));
    if (!st || st.hidden) throw Object.assign(new Error('Цей студент приховав свій розклад'), { status: 404 });
    const theirs = [...WEEK.filter((e) => st.calendars.includes(e.calendarId)), { calendarId: 6, courseCode: 'POL101', section: 'L2', title: 'Political Science', location: LOC.s2151, day: 2, from: '13:30', to: '14:50' }];
    const events = weekEvents(u.searchParams.get('start'), theirs).map((e) => ({ ...e, shared: [1, 2, 3, 4, 5].includes(e.calendarId) }));
    const { calendars: _c, hidden: _h, ...rest } = st;
    const student = { ...rest, avatarUrl: null };
    return { student, weekStart: u.searchParams.get('start'), events, sharedCourses: [...new Set(events.filter((e) => e.shared).map((e) => `${e.courseCode} [${e.section}]`))] };
  }],
  ['GET', /^\/moodle\/deadlines$/, () => ({ deadlines: empty ? [] : DEADLINES })],
  ['GET', /^\/moodle\/courses$/, () => ({ courses: [] })],
  ['POST', /^\/moodle\/sync$/, () => ({ ok: true })],
  ['PATCH', /^\/moodle\/assignments\/(\d+)\/toggle$/, (m) => {
    const d = DEADLINES.find((x) => x.assignment.id === Number(m[1]));
    if (d) d.assignment.isCompleted = !d.assignment.isCompleted;
    return { ok: true };
  }],
  ['GET', /^\/mail\/important$/, () => ({ emails: empty ? [] : MAIL })],
  ['GET', /^\/rooms$/, () => ({ rooms: ROOMS })],
  ['GET', /^\/rooms\/available$/, (_m, u) => ({ rooms: availability(Date.parse(u.searchParams.get('start')!), Date.parse(u.searchParams.get('end')!)) })],
  ['GET', /^\/rooms\/quota$/, () => ({ used: usedHours(), remaining: 3 - usedHours(), max: 3 })],
  ['GET', /^\/rooms\/my-bookings$/, () => ({
    bookings: BOOKINGS.filter((b) => b.userId === 1 && b.status === 'active' && Date.parse(b.endTime) > NOW.getTime())
      .map((b) => ({ booking: b, room: ROOMS.find((r) => r.id === b.roomId) })),
  })],
  ['GET', /^\/rooms\/(\d+)\/schedule$/, (m) => ({ room: ROOMS.find((r) => r.id === Number(m[1])), bookings: BOOKINGS.filter((b) => b.roomId === Number(m[1]) && b.status === 'active') })],
  ['POST', /^\/rooms\/book$/, (_m, _u, body) => {
    const { roomId, startTime, endTime } = body as { roomId: number; startTime: string; endTime: string };
    const hours = (Date.parse(endTime) - Date.parse(startTime)) / 3_600_000;
    if (usedHours() + hours > 3) throw Object.assign(new Error(`Денна квота — 3 год. Сьогодні лишилось ${Math.round((3 - usedHours()) * 60)} хв`), { status: 409 });
    if (BOOKINGS.some((b) => b.roomId === roomId && b.status === 'active' && Date.parse(b.startTime) < Date.parse(endTime) && Date.parse(b.endTime) > Date.parse(startTime))) {
      throw Object.assign(new Error('Цей час уже хтось забронював. Обери інший або іншу кімнату'), { status: 409 });
    }
    const booking = { id: 1000 + BOOKINGS.length, roomId, userId: 1, startTime, endTime, status: 'active', createdAt: iso(NOW) };
    BOOKINGS.push(booking);
    return { booking, room: ROOMS.find((r) => r.id === roomId) };
  }],
  ['DELETE', /^\/rooms\/bookings\/(\d+)$/, (m) => {
    const b = BOOKINGS.find((x) => x.id === Number(m[1]));
    if (b) b.status = 'cancelled';
    return { booking: b };
  }],
  ['GET', /^\/careers$/, (_m, u) => {
    const cat = u.searchParams.get('category');
    const qq = (u.searchParams.get('search') || '').toLowerCase();
    return { opportunities: empty ? [] : OPPS.filter((o) => (!cat || o.category === cat) && (u.searchParams.get('saved') !== 'true' || o.saved) && (!qq || `${o.title} ${o.company}`.toLowerCase().includes(qq))) };
  }],
  ['POST', /^\/careers\/(\d+)\/save$/, (m, _u, b) => {
    const o = OPPS.find((x) => x.id === Number(m[1]));
    if (o) o.saved = (b as { saved: boolean }).saved;
    return { saved: o?.saved };
  }],
  ['POST', /^\/copilot\/chat$/, () => ({ content: 'Ось план на 3 кроки:\n\n1. Перечитай умову і виділи, що саме треба здати.\n2. Заклади **2 години** на чернетку сьогодні ввечері.\n3. Завтра зранку — перевірка і здача до 10:00.', toolCalls: [] })],
  ['GET', /^\/venture\/startups$/, () => ({ startups: empty ? [] : STARTUPS })],
  ['GET', /^\/venture\/projects$/, () => ({ projects: [] })],
  ['GET', /^\/venture\/applications$/, () => ({
    incoming: [],
    outgoing: [{ id: 41, projectId: 22, role: 'Backend', message: null, status: 'pending', createdAt: iso(NOW), project: { id: 22, title: 'CampusEats' }, author: { name: 'Данило Гнатенко', contact: null } }],
  })],
  ['GET', /^\/venture\/profile$/, () => ({ profile: null })],
  ['GET', /^\/courses\/([A-Z0-9]+)\/mail$/, () => ({ emails: empty ? [] : [
    { id: 'm1', subject: 'MATH111: перенесення консультації на четвер', from: 'Olena Hrytsenko', receivedAt: hours(-20), url: 'https://mail.google.com' },
    { id: 'm2', subject: 'MATH111 Homework 2 is out', from: 'Moodle KSE', receivedAt: hours(-50), url: 'https://mail.google.com' },
  ] })],
  ['GET', /^\/courses\/([A-Z0-9]+)$/, (m) => ({
    code: m[1], title: 'Introduction to Calculus', sections: ['L2', 'P6'],
    nextClass: { id: 900, calendarId: 3, courseCode: m[1], section: 'P6', title: 'Introduction to Calculus', location: 'M. Shpaka 3, 3.05', startAt: hours(2), endAt: hours(3.5) },
    deadlines: empty ? [] : DEADLINES.filter((d) => d.courseName.startsWith(m[1])),
    slack: { url: 'https://kse-students.slack.com/archives/C07ABCDE12', name: `${m[1].toLowerCase()}-fall26` },
    officeHours: null,
    friends: [{ userId: 2, name: 'Danylo Bondar', avatarUrl: null, sameSection: true }],
  })],
  ['GET', /^\/events$/, () => ({ events: empty ? [] : EVENTS })],
  ['GET', /^\/events\/(\d+)$/, (m) => ({ event: EVENTS.find((e) => e.id === Number(m[1])) })],
  ['POST', /^\/events\/(\d+)\/remind$/, (m) => { EVENTS.find((e) => e.id === Number(m[1]))!.reminded = true; return { reminded: true, remindAt: hours(20) }; }],
  ['DELETE', /^\/events\/(\d+)\/remind$/, (m) => { EVENTS.find((e) => e.id === Number(m[1]))!.reminded = false; return { reminded: false }; }],
  ['GET', /^\/reminders$/, () => ({ reminders: empty ? [] : REMINDERS })],
  ['POST', /^\/reminders$/, (_m, _u, b) => {
    const { text, remindAt } = b as { text: string; remindAt: string };
    const reminder = { id: REMINDERS.length + 100, kind: 'self', text, remindAt, startapp: null, eventId: null };
    REMINDERS.push(reminder);
    return { reminder };
  }],
  ['POST', /^\/reminders\/friend$/, () => ({ id: 1, delivered: true, opensDeadline: true })],
  ['DELETE', /^\/reminders\/(\d+)$/, (m) => { REMINDERS.splice(REMINDERS.findIndex((r) => r.id === Number(m[1])), 1); return { ok: true }; }],
  ['GET', /^\/friends$/, () => (empty ? { friends: [], incoming: [], outgoing: [] } : FRIENDS)],
  ['GET', /^\/friends\/invite$/, () => ({ link: 'https://t.me/ksehub_bot?start=inv_1_mockcode' })],
  ['POST', /^\/friends\/request$/, () => ({ status: 'pending' })],
  ['POST', /^\/friends\/import$/, () => ({ results: [] })],
  ['POST', /^\/friends\/(\d+)\/(accept|decline)$/, (m) => {
    const i = FRIENDS.incoming.findIndex((f) => f.friendshipId === Number(m[1]));
    const [f] = FRIENDS.incoming.splice(i, 1);
    if (m[2] === 'accept' && f) FRIENDS.friends.push(f);
    return { status: m[2] === 'accept' ? 'accepted' : 'declined', alreadyDecided: false };
  }],
  ['DELETE', /^\/friends\/(\d+)$/, (m) => { FRIENDS.friends = FRIENDS.friends.filter((f) => f.userId !== Number(m[1])); return { ok: true }; }],
  ['GET', /^\/admin\/analytics$/, (_m, url) => adminAnalytics(Number(url.searchParams.get('days')) || 7)],
  ['GET', /^\/admin\/slack$/, () => (empty ? { channels: [], drafts: [], courses: SLACK.courses, programs: SLACK.programs } : SLACK)],
  ['PATCH', /^\/admin\/slack\/channels\/(\w+)$/, (m, _u, b) => {
    const ch = SLACK.channels.find((c) => c.channelId === m[1])!;
    const { scope, ...rest } = b as { scope?: { kind: string; courseCode?: string; section?: string | null; program?: string | null; cohortYear?: number } | null };
    Object.assign(ch, rest);
    if (scope !== undefined) {
      Object.assign(ch, { courseCode: scope?.courseCode ?? null, section: scope?.section ?? null, program: scope?.program ?? null, cohortYear: scope?.cohortYear ?? null });
      if (ch.isPrivate && ch.status !== 'hidden') ch.status = scope ? 'active' : 'pending';
    }
    return { channel: ch };
  }],
  ['POST', /^\/admin\/slack\/summaries\/(\d+)\/(publish|reject)$/, (m) => {
    SLACK.drafts = SLACK.drafts.filter((d) => d.id !== Number(m[1]));
    return m[2] === 'publish' ? { summary: { id: Number(m[1]), status: 'published' } } : { ok: true };
  }],
  ['GET', /^\/venture\/deck$/, () => ({ cards: empty ? [] : DECK })],
  // Олена has already said "Цікаво" to us, so only our own "Цікаво" makes it mutual
  ['POST', /^\/venture\/swipe$/, (_m, _u, b) => {
    DECK.shift();
    return (b as { isLike: boolean }).isLike
      ? { matched: true, matchedUser: { id: 3, telegramId: 3, username: 'okoval', fullName: 'Олена Коваленко', avatarUrl: null } }
      : { matched: false };
  }],
];

const EVENTS = [
  { id: 1, title: 'Семінар з відбудови економіки', startsAt: hours(54), location: 'ICU Hall', programs: [] as string[],
    description: 'Відкрита лекція про відбудову економіки України після війни: що вже працює і де бракує людей. Українською.',
    registrationUrl: 'https://forms.gle/mock', personal: false, reminded: false, createdAt: iso(NOW) },
  { id: 2, title: 'Debate Club: перша зустріч семестру', startsAt: hours(80), location: 'M. Shpaka 3, 2.15', programs: ['BE'],
    description: 'Знайомство, формат British Parliamentary і перша тренувальна гра.', registrationUrl: null, personal: false, reminded: true, createdAt: iso(NOW) },
  { id: 3, title: 'Career Day: зустріч з Kyivstar', startsAt: hours(200), location: 'Online', programs: [] as string[],
    description: 'Як потрапити на літнє стажування: відбір, задачі, зарплата.', registrationUrl: 'https://forms.gle/mock2', personal: false, reminded: false, createdAt: iso(NOW) },
];

/* /admin → Slack: drafts from the reader account's first run, channels with their ties */
const slackLink = (ch: string, ts: string) => `https://ksestudents.slack.com/archives/${ch}/p${ts}`;
const slackChannel = (channelId: string, name: string, isPrivate: boolean, extra: Record<string, unknown> = {}) => ({
  channelId, name, team: 'ksestudents', isPrivate, status: 'active' as string, courseCode: null as string | null, section: null as string | null,
  program: null as string | null, cohortYear: null as number | null, lastTs: '1793305990.827519', defaultOn: false, autoPublish: false,
  createdAt: iso(NOW), drafts: 0, published: 0, ...extra,
});
const SLACK = {
  channels: [
    slackChannel('C0BU8PC0TD2', 'intro_to_calculus-pr6-autumn-2026', true, { courseCode: 'MATH111', section: 'P6', drafts: 1 }),
    slackChannel('G0COHORT30', 'be30', true, { program: 'BE', cohortYear: 2026, published: 3 }),
    slackChannel('G0KSEBA30', 'kse-ba30', true, { status: 'pending' }),
    slackChannel('C05Q8FTNP0T', 'general', false, { defaultOn: true, drafts: 1 }),
    slackChannel('C06KXECQQFQ', 'event', false, { defaultOn: true, drafts: 1, autoPublish: true }),
    slackChannel('C05QB2Q0TJ8', 'students', false, { drafts: 1 }),
    slackChannel('C05Q8JQF03C', 'random', false, { status: 'hidden' }),
  ],
  drafts: [
    { id: 1, channelId: 'C0BU8PC0TD2', channelName: 'intro_to_calculus-pr6-autumn-2026', isPrivate: true, courseCode: 'MATH111', section: 'P6',
      fromTs: '1793047000.000000', toTs: '1793305990.827519', status: 'draft', createdAt: hours(-0.5), publishedAt: null,
      summary: 'Наступного тижня пари онлайн і без квізу\nЧерез тиждень — 2 квізи',
      items: [
        { kind: 'change', text: 'Наступного тижня пари онлайн і без квізу', permalink: slackLink('C0BU8PC0TD2', '1793175881366969') },
        { kind: 'announcement', text: 'Через тиждень — 2 квізи: на першій і на другій парі', permalink: slackLink('C0BU8PC0TD2', '1793175881366969') },
      ],
      events: [] as { title: string; startsAt: string; place?: string; permalink: string }[] },
    { id: 2, channelId: 'C05Q8FTNP0T', channelName: 'general', isPrivate: false, courseCode: null, section: null,
      fromTs: '1793047000.000000', toTs: '1793286952.584809', status: 'draft', createdAt: hours(-0.5), publishedAt: null,
      summary: '',
      items: [
        { kind: 'announcement', text: 'Психологічна служба: запис відкривається наприкінці кожного місяця на 3–4 тижні вперед, до 10 консультацій на рік', permalink: slackLink('C05Q8FTNP0T', '1793108700126039') },
        { kind: 'announcement', text: 'У Study Room на 3 поверсі встановили принтер', permalink: slackLink('C05Q8FTNP0T', '1793180603643829') },
      ],
      events: [] },
    { id: 3, channelId: 'C05QB2Q0TJ8', channelName: 'students', isPrivate: false, courseCode: null, section: null,
      fromTs: '1793047000.000000', toTs: '1793303763.977339', status: 'draft', createdAt: hours(-0.5), publishedAt: null,
      summary: '',
      items: [
        { kind: 'deadline', text: 'Probability and Games (KSE Quant Club): реєстрація', dueAt: '2026-12-10T23:59:00+02:00', permalink: slackLink('C05QB2Q0TJ8', '1793216247829659') },
        { kind: 'event', text: 'Talk to an Expert: GameDev, кампус і онлайн', dueAt: '2026-11-06T18:00:00+02:00', permalink: slackLink('C05QB2Q0TJ8', '1793115726802289') },
        { kind: 'other', text: 'ACLED: оплачувана часткова дослідницька позиція', permalink: slackLink('C05QB2Q0TJ8', '1793204816122639') },
      ],
      events: [{ title: 'Talk to an Expert: GameDev', startsAt: '2026-11-06T18:00:00+02:00', place: 'KSE Dragon Capital Building + онлайн', permalink: slackLink('C05QB2Q0TJ8', '1793115726802289') }] },
  ],
  courses: [
    { courseCode: 'ECON100', title: 'Principles of Economics (BE)', sections: ['L1', 'P6'] },
    { courseCode: 'ENG111', title: 'English for Professional and Study Purposes I (BE, EBD)', sections: ['P11'] },
    { courseCode: 'KSE101', title: 'How to study at KSE (BE, EBD, SE)', sections: ['L3'] },
    { courseCode: 'MATH101', title: 'Introduction to Mathematics', sections: ['P8'] },
    { courseCode: 'MATH111', title: 'Introduction to Calculus (BE, EBD)', sections: ['P6', 'P7'] },
  ],
  programs: ['BE', 'EBD'],
};

const REMINDERS = [
  { id: 1, kind: 'self', text: 'почати есе з ECON100', remindAt: hours(30), startapp: null as string | null, eventId: null as number | null },
];

// Данило is a friend, Олена asked us, we asked Марко
const FRIENDS = {
  friends: [{ friendshipId: 1, userId: 2, name: 'Danylo Bondar', avatarUrl: null, username: 'dbondar' }],
  incoming: [{ friendshipId: 2, userId: 3, name: 'Olena Kovalenko', avatarUrl: null, username: 'okoval' }],
  outgoing: [{ friendshipId: 3, userId: 4, name: 'Marko Shevchuk', avatarUrl: null, username: 'mshev' }],
};

/** /admin dashboard for the first test week: ~12 students, MATH101 [P8] and friends. */
function adminAnalytics(days: number) {
  const today = '2026-10-28';
  const series = (values: number[]) => values.slice(-days).map((v, i, a) => ({
    day: new Date(Date.parse(today) - (a.length - 1 - i) * 86_400_000).toISOString().slice(0, 10), v,
  }));
  const active = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 1, 2, 1, 2, 3, 2, 4, 5, 7, 6, 8, 9, 8];
  const ai = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 2, 3, 6, 1, 4, 9, 5, 11, 14, 22, 17, 25, 31, 19];
  const fresh = [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 0, 1, 0, 1, 1, 0, 2, 1, 3, 1, 2, 2, 1];
  if (empty) {
    return { days, today, pulse: { dau: 0, wau: 0, active: 0, newToday: 0, users: 0, onboarded: 0, activation: { eligible: 0, activated: 0, rate: 0 }, daily: [] },
      funnel: [], retention: [], features: [], pushes: [], ai: { daily: [], messages: 0, perActive: 0, limitHits: 0, errors: 0, tools: [], topics: [] },
      friends: { requests: 0, accepted: 0, invitesSent: 0, inviters: 0, joined: 0, inviteRate: 0, avgFriends: null }, health: [] };
  }
  const dailyActive = series(active);
  const dailyNew = series(fresh);
  return {
    days, today,
    pulse: {
      dau: 8, wau: 11, active: 12, newToday: 1, users: 15, onboarded: 12,
      activation: { eligible: 9, activated: 4, rate: 44 },
      daily: dailyActive.map((p, i) => ({ day: p.day, active: p.v, newUsers: dailyNew[i].v })),
    },
    funnel: [
      { key: 'start', users: 14, pct: 100, dropped: 0 }, { key: 'auth', users: 13, pct: 93, dropped: 1 },
      { key: 'schedule', users: 13, pct: 93, dropped: 0 }, { key: 'program', users: 12, pct: 86, dropped: 1 },
      { key: 'digest', users: 12, pct: 86, dropped: 0 }, { key: 'moodle', users: 9, pct: 64, dropped: 3 },
      { key: 'done', users: 9, pct: 64, dropped: 0 },
    ],
    retention: [
      { week: '2026-10-26', size: 4, d1: 50, d7: null, d14: null, d30: null },
      { week: '2026-10-19', size: 6, d1: 67, d7: 50, d14: null, d30: null },
      { week: '2026-10-12', size: 2, d1: 100, d7: 50, d14: 50, d30: null },
    ],
    features: [
      { key: 'tab.today', users: 11, prev: 6, share: 92, trend: 5, dead: false },
      { key: 'tab.schedule', users: 10, prev: 5, share: 83, trend: 5, dead: false },
      { key: 'ai.message', users: 8, prev: 4, share: 67, trend: 4, dead: false },
      { key: 'tab.deadlines', users: 7, prev: 4, share: 58, trend: 3, dead: false },
      { key: 'tab.rooms', users: 5, prev: 3, share: 42, trend: 2, dead: false },
      { key: 'deadline.sheet_open', users: 5, prev: 1, share: 42, trend: 4, dead: false },
      { key: 'booking.created', users: 3, prev: 2, share: 25, trend: 1, dead: false },
      { key: 'deadline.done', users: 3, prev: 0, share: 25, trend: 3, dead: false },
      { key: 'tab.forYou', users: 2, prev: 2, share: 17, trend: 0, dead: false },
      { key: 'schedule.friend_added', users: 2, prev: 0, share: 17, trend: 2, dead: false },
      { key: 'tab.profile', users: 2, prev: 1, share: 17, trend: 1, dead: false },
      { key: 'deadline.moodle_open', users: 1, prev: 0, share: 8, trend: 1, dead: false },
      { key: 'tab.startups', users: 0, prev: 1, share: 0, trend: -1, dead: true },
      { key: 'tab.people', users: 0, prev: 0, share: 0, trend: 0, dead: true },
      { key: 'opp.apply_click', users: 0, prev: 0, share: 0, trend: 0, dead: true },
      { key: 'opp.saved', users: 0, prev: 0, share: 0, trend: 0, dead: true },
    ],
    pushes: [
      { type: 'digest', sent: 58, opened: 14, ctr: 24 }, { type: 'd24', sent: 17, opened: 6, ctr: 35 },
      { type: 'd3', sent: 9, opened: 5, ctr: 56 }, { type: 'change', sent: 6, opened: 3, ctr: 50 },
      { type: 'urgent', sent: 4, opened: 0, ctr: 0 }, { type: 'onboarding', sent: 9, opened: 2, ctr: 22 },
    ],
    ai: {
      daily: series(ai).map((p) => ({ day: p.day, messages: p.v })),
      messages: 168, perActive: 14, limitHits: 2, errors: 1,
      tools: [
        { name: 'get_my_schedule', times: 41 }, { name: 'get_available_rooms', times: 23 }, { name: 'get_my_deadlines', times: 19 },
        { name: 'book_room', times: 9 }, { name: 'search_kse_info', times: 8 }, { name: 'search_my_emails', times: 5 },
      ],
      topics: [
        { topic: 'schedule', times: 52 }, { topic: 'rooms', times: 34 }, { topic: 'deadlines', times: 27 },
        { topic: 'kse', times: 18 }, { topic: 'other', times: 22 }, { topic: 'mail', times: 9 },
      ],
    },
    friends: { requests: 0, accepted: 0, invitesSent: 0, inviters: 0, joined: 0, inviteRate: 0, avgFriends: null },
    health: [
      { key: 'mail_revoked', value: 0, total: 12, alert: false }, { key: 'no_schedule', value: 2, total: 12, alert: false },
      { key: 'no_moodle', value: 5, total: 12, alert: false }, { key: 'digest_failed', value: 1, total: 12, alert: true },
      { key: 'bot_blocked', value: 0, total: 12, alert: false },
    ],
  };
}

const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const url = new URL(raw, location.origin);
  if (!url.pathname.startsWith('/api/')) return realFetch(input, init);
  const path = url.pathname.slice(4);
  const method = (init?.method || 'GET').toUpperCase();
  await new Promise((r) => setTimeout(r, 250));
  if (state === 'auth' && path !== '/users/me') return ok({ error: 'Invalid Telegram authorization', code: 'auth_invalid' }, 401);
  if (path === '/auth/session') return ok({ token: 'mock-session', expiresAt: iso(new Date(Date.now() + 86_400_000)) });
  if (state === 'stale' && path !== '/users/me') throw new TypeError('Failed to fetch');
  if (state === 'error' && path !== '/users/me') return ok({ error: 'Internal server error' }, 500);
  for (const [m, re, handler] of routes) {
    const match = method === m && path.match(re);
    if (!match) continue;
    try {
      return ok(handler(match, url, init?.body ? JSON.parse(String(init.body)) : undefined));
    } catch (e) {
      return ok({ error: (e as Error).message }, (e as { status?: number }).status || 500);
    }
  }
  console.warn('[tg-mock] no mock for', method, path);
  return ok({ error: `No mock for ${method} ${path}` }, 404);
};
