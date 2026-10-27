/*
 * Dev-only stand-in for Telegram and the API: http://localhost:5173/?mock=1&theme=dark
 *   &theme=light|dark   Telegram theme (default: system)
 *   &now=11:45          pretend it's this time today (default 11:45, so a class is in progress)
 *   &state=empty|error  every list empty / every request fails
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
  colorScheme: scheme,
  themeParams: theme,
  viewportHeight: 0,
  viewportStableHeight: 0,
  isVersionAtLeast: () => true,
  ready() {}, expand() {}, close() { log('close'); },
  enableClosingConfirmation() {}, disableVerticalSwipes() {},
  onEvent(e: string, cb: () => void) { (listeners[e] ||= new Set()).add(cb); },
  offEvent(e: string, cb: () => void) { listeners[e]?.delete(cb); },
  setHeaderColor(c: string) { head.style.background = c; },
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
].map((d) => ({
  assignment: { id: d.id, userId: 1, courseId: null, externalId: null, title: d.title, dueDate: d.due, sourceUrl: 'https://teaching.kse.org.ua/mod/assign/view.php?id=1', isCompleted: false, type: d.type, createdAt: iso(NOW) },
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
    return { ...r, available: !busy, freeFrom: busy ? iso(new Date(t)) : null };
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
    return { students: s.length < 2 ? [] : STUDENTS.filter((x) => `${x.name} ${x.fullName}`.toLowerCase().includes(s)).map(({ calendars: _c, hidden: _h, ...x }) => x) };
  }],
  ['GET', /^\/schedule\/compare\/(\d+)$/, (m, u) => {
    const st = STUDENTS.find((x) => x.userId === Number(m[1]));
    if (!st || st.hidden) throw Object.assign(new Error('Цей студент приховав свій розклад'), { status: 404 });
    const theirs = [...WEEK.filter((e) => st.calendars.includes(e.calendarId)), { calendarId: 6, courseCode: 'POL101', section: 'L2', title: 'Political Science', location: LOC.s2151, day: 2, from: '13:30', to: '14:50' }];
    const events = weekEvents(u.searchParams.get('start'), theirs).map((e) => ({ ...e, shared: [1, 2, 3, 4, 5].includes(e.calendarId) }));
    const { calendars: _c, hidden: _h, ...student } = st;
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
  ['GET', /^\/venture\/deck$/, () => ({ cards: empty ? [] : DECK })],
  // Олена has already said "Цікаво" to us, so only our own "Цікаво" makes it mutual
  ['POST', /^\/venture\/swipe$/, (_m, _u, b) => {
    DECK.shift();
    return (b as { isLike: boolean }).isLike
      ? { matched: true, matchedUser: { id: 3, telegramId: 3, username: 'okoval', fullName: 'Олена Коваленко', avatarUrl: null } }
      : { matched: false };
  }],
];

const realFetch = window.fetch.bind(window);
window.fetch = async (input, init) => {
  const raw = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const url = new URL(raw, location.origin);
  if (!url.pathname.startsWith('/api/')) return realFetch(input, init);
  const path = url.pathname.slice(4);
  const method = (init?.method || 'GET').toUpperCase();
  await new Promise((r) => setTimeout(r, 250));
  if (state === 'error' && path !== '/users/me') return ok({ error: 'Не вдалося завантажити. Перевір інтернет і спробуй ще раз.' }, 500);
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
