import { InlineKeyboard } from 'grammy';
import { appUrl, escapeHtml } from './send.js';

/*
 * Every push the bot sends, built from the templates in PRODUCT.md:
 * one topic per message, the first line says what and when, course codes as KSE writes them,
 * places as "корпус, аудиторія", at most one button, and it opens the exact screen.
 */

export type Lang = 'uk' | 'en';
const TZ = 'Europe/Kyiv';
const t = (lang: Lang, uk: string, en: string) => (lang === 'en' ? en : uk);
const loc = (lang: Lang) => (lang === 'en' ? 'en-GB' : 'uk-UA');

/**
 * A web-app button that opens the mini app on one screen: startapp=day_2026-10-27, deadline_12, …
 * `push` tags the kind of message after "__" (deadline_12__d24) so the app can report which pushes get opened.
 */
export function appButton(label: string, startapp?: string, push?: string) {
  const param = push ? `${startapp ?? 'today'}__${push}` : startapp;
  return new InlineKeyboard().webApp(label, param ? `${appUrl()}/?startapp=${encodeURIComponent(param)}` : appUrl());
}

/* ─── Dates and places ─── */

/** "2026-10-27" in Kyiv */
export const kyivDay = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
/** "09:30" */
export const hm = (d: Date) => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(d);
/** "Вівторок, 27 жовтня" */
export function dayHeading(d: Date, lang: Lang) {
  const s = new Intl.DateTimeFormat(loc(lang), { timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long' }).format(d);
  return s.charAt(0).toUpperCase() + s.slice(1);
}
/** "пт 30.10" */
export function shortDay(d: Date, lang: Lang) {
  const wd = new Intl.DateTimeFormat(loc(lang), { timeZone: TZ, weekday: 'short' }).format(d).replace('.', '').toLowerCase();
  const [y, m, day] = kyivDay(d).split('-');
  void y;
  return `${wd} ${Number(day)}.${m}`;
}
/** "пт 30.10, 15:00" */
export const shortDateTime = (d: Date, lang: Lang) => `${shortDay(d, lang)}, ${hm(d)}`;

/** "через 5 год" today, then by calendar days: "завтра", "через 3 дні" */
export function inTime(d: Date, now: Date, lang: Lang) {
  const days = Math.round((Date.parse(kyivDay(d)) - Date.parse(kyivDay(now))) / 86_400_000);
  if (days <= 0) {
    const h = Math.round((d.getTime() - now.getTime()) / 3_600_000);
    return h < 1 ? t(lang, 'менше години', 'under an hour') : t(lang, `через ${h} год`, `in ${h} h`);
  }
  if (days === 1) return t(lang, 'завтра', 'tomorrow');
  return lang === 'en' ? `in ${days} days` : `через ${days} ${days % 10 >= 2 && days % 10 <= 4 && (days % 100 < 12 || days % 100 > 14) ? 'дні' : 'днів'}`;
}

/**
 * "M. Shpaka 3, 2.15.1 Roy Gartner Memorial Classroom" → "M. Shpaka 3, 2.15.1": the building in Latin,
 * as the schedule source writes it, and the room number; sponsor names of rooms are dropped.
 */
export function shortPlace(location: string | null | undefined, lang: Lang = 'uk'): string | null {
  if (!location?.trim()) return null;
  if (/^online$/i.test(location.trim())) return t(lang, 'Онлайн', 'Online');
  const [building, rest] = location.split(/,\s*/, 2);
  const room = rest?.trim().split(/\s+/)[0];
  return room ? `${building.trim()}, ${room}` : building.trim();
}

/** "ECON100 [P6]" */
export const courseLabel = (code: string, section?: string | null) => (section ? `${code} [${section}]` : code);
/** "ECON100 Principles of Economics" → "ECON100" */
export const courseCode = (name: string | null | undefined) => name?.match(/^[A-Z]{2,5}\d{3}/)?.[0] ?? name ?? '';
/** University-wide Moodle events: shown in the app, never pushed */
export const isGeneralCourse = (name: string | null | undefined) => /general\s*\/\s*university/i.test(name ?? '');

/* ─── Templates ─── */

export type DigestClass = { courseCode: string; section: string | null; location: string | null; startAt: Date };
export type DigestDeadline = { title: string; courseName: string | null; dueDate: Date };
export type DigestMail = { subject: string | null; summary: string };

/** The daily digest. Returns null when there's nothing to say. */
export function digestText(p: {
  lang: Lang; now: Date; day: Date; classes: DigestClass[]; deadlines: DigestDeadline[];
  events?: { title: string; startsAt: Date; location: string | null }[]; moodle?: DigestMail[]; mail: DigestMail[]; slack: DigestMail[];
}): string | null {
  const { lang, now } = p;
  const sections: string[] = [];
  if (p.classes.length) {
    sections.push(`<b>${t(lang, 'Пари', 'Classes')}</b>\n` + p.classes.map((c) =>
      `${hm(c.startAt)}  ${escapeHtml(courseLabel(c.courseCode, c.section))}${shortPlace(c.location, lang) ? ` · ${escapeHtml(shortPlace(c.location, lang)!)}` : ''}`).join('\n'));
  }
  if (p.deadlines.length) {
    sections.push(`<b>${t(lang, 'Дедлайни', 'Deadlines')}</b>\n` + p.deadlines.map((d) =>
      `${shortDateTime(d.dueDate, lang)} · ${[courseCode(d.courseName), d.title].filter(Boolean).map(escapeHtml).join(' · ')} · ${inTime(d.dueDate, now, lang)}`).join('\n'));
  }
  if (p.events?.length) {
    sections.push(`<b>${t(lang, 'Події', 'Events')}</b>\n` + p.events.map((e) =>
      `${hm(e.startsAt)}  ${escapeHtml(e.title)}${e.location ? ` · ${escapeHtml(e.location)}` : ''}`).join('\n'));
  }
  const mailSection = (title: string, items: DigestMail[]) =>
    `<b>${title}</b>\n` + items.map((m) => {
      const subject = escapeHtml(m.subject || t(lang, 'Без теми', 'No subject'));
      // Receipts and feedback carry no summary beyond the subject
      return m.summary === m.subject ? subject : `${subject}\n<blockquote expandable>${escapeHtml(m.summary)}</blockquote>`;
    }).join('\n');
  if (p.moodle?.length) sections.push(mailSection('Moodle', p.moodle));
  if (p.mail.length) sections.push(mailSection(t(lang, 'Пошта', 'Mail'), p.mail));
  if (p.slack.length) sections.push(mailSection('Slack', p.slack));
  if (!sections.length) return null;
  return `<b>${escapeHtml(dayHeading(p.day, lang))}</b>\n\n${sections.join('\n\n')}`;
}

export type Change =
  | { kind: 'moved'; before: { startAt: Date }; after: { startAt: Date; location: string | null } }
  | { kind: 'room'; before: { startAt: Date }; after: { startAt: Date; location: string | null } }
  | { kind: 'cancelled'; before: { startAt: Date } }
  | { kind: 'added'; after: { startAt: Date; location: string | null } };

/** "Пару перенесли" etc.: one message per course section, the heading names what happened. */
export function scheduleChangeText(lang: Lang, code: string, section: string | null, changes: Change[]): string {
  const course = escapeHtml(courseLabel(code, section));
  const kinds = new Set(changes.map((c) => c.kind));
  const heading = kinds.size > 1 ? t(lang, `Зміни в розкладі ${course}`, `Schedule changes for ${course}`)
    : kinds.has('moved') ? t(lang, 'Пару перенесли', 'Class moved')
    : kinds.has('room') ? t(lang, 'Нова аудиторія', 'New room')
    : kinds.has('cancelled') ? t(lang, 'Пару скасували', 'Class cancelled')
    : t(lang, 'Додали пару', 'Class added');
  const single = kinds.size === 1;
  const lines = changes.slice(0, 8).map((c) => {
    const prefix = single ? `${course}: ` : '';
    switch (c.kind) {
      case 'moved': {
        const place = shortPlace(c.after.location, lang);
        return `${prefix}${shortDay(c.before.startAt, lang)} → <b>${shortDateTime(c.after.startAt, lang)}</b>${place ? `\n${escapeHtml(place)}` : ''}`;
      }
      case 'room':
        return `${prefix}${shortDateTime(c.after.startAt, lang)}\n<b>${escapeHtml(shortPlace(c.after.location, lang) ?? t(lang, 'без аудиторії', 'no room'))}</b>`;
      case 'cancelled':
        return `${prefix}${shortDateTime(c.before.startAt, lang)}`;
      case 'added': {
        const place = shortPlace(c.after.location, lang);
        return `${prefix}${shortDateTime(c.after.startAt, lang)}${place ? ` · ${escapeHtml(place)}` : ''}`;
      }
    }
  });
  const more = changes.length > 8 ? `\n${t(lang, `…і ще ${changes.length - 8}`, `…and ${changes.length - 8} more`)}` : '';
  return `<b>${heading}</b>\n${lines.join('\n')}${more}`;
}

/** The day a schedule change lands on: where "Відкрити розклад" should take the student. */
export const changeDay = (c: Change) => kyivDay(c.kind === 'cancelled' ? c.before.startAt : c.after.startAt);

/** "MATH111 через 15 хв" + place. No button: everything needed is in the text. */
export function classSoonText(lang: Lang, code: string, section: string | null, minutes: number, location: string | null, startAt: Date) {
  const place = shortPlace(location, lang);
  const when = t(lang, `через ${minutes} хв, о ${hm(startAt)}`, `in ${minutes} min, at ${hm(startAt)}`);
  return `<b>${escapeHtml(courseLabel(code, section))} ${when}</b>${place ? `\n${escapeHtml(place)}` : ''}`;
}

/**
 * Classes over several days for the assistant to copy as they are: a day heading "Вт 27.10",
 * then one line per class "11:30–12:50  ECON100 [P6] · M. Shpaka 3, 4.08".
 */
export function scheduleByDay(events: { courseCode: string; section: string | null; location: string | null; startAt: Date; endAt: Date }[], lang: Lang) {
  const days = new Map<string, string[]>();
  for (const e of [...events].sort((a, b) => a.startAt.getTime() - b.startAt.getTime())) {
    const d = shortDay(e.startAt, lang);
    const heading = d.charAt(0).toUpperCase() + d.slice(1);
    const place = shortPlace(e.location, lang);
    const line = `${hm(e.startAt)}–${hm(e.endAt)}  ${courseLabel(e.courseCode, e.section)}${place ? ` · ${place}` : ''}`;
    days.set(heading, [...(days.get(heading) ?? []), line]);
  }
  return [...days].map(([day, classes]) => ({ day, classes }));
}

/** 24 h and 3 h before a Moodle deadline. */
export function deadlineReminderText(lang: Lang, kind: '24h' | '3h', d: DigestDeadline) {
  const head = kind === '3h'
    ? t(lang, `До дедлайну менше 3 годин, о ${hm(d.dueDate)}`, `Due in under 3 hours, at ${hm(d.dueDate)}`)
    : t(lang, `Дедлайн завтра, ${shortDateTime(d.dueDate, lang)}`, `Due tomorrow, ${shortDateTime(d.dueDate, lang)}`);
  return `<b>${head}</b>\n${escapeHtml(d.title)}${d.courseName ? `\n${escapeHtml(courseCode(d.courseName))}` : ''}`;
}

/** Sunday evening: next week's deadlines, one line each. */
export function weeklyText(lang: Lang, rows: DigestDeadline[]) {
  return `<b>${t(lang, 'Дедлайни на тиждень', "This week's deadlines")}</b>\n` +
    rows.map((d) => `${shortDateTime(d.dueDate, lang)} · ${[courseCode(d.courseName), d.title].filter(Boolean).map(escapeHtml).join(' · ')}`).join('\n');
}

/** Right after booking in the app. */
export function bookingText(lang: Lang, room: string, floor: number | null, start: Date, end: Date, now: Date) {
  const day = kyivDay(start) === kyivDay(now) ? t(lang, 'сьогодні', 'today') : shortDay(start, lang);
  const name = room.replace(/\s*\(.*\)\s*$/, '');
  return `<b>${t(lang, 'Заброньовано', 'Booked')}: ${escapeHtml(name)}</b>\n${day}, ${hm(start)}–${hm(end)}${floor ? ` · ${t(lang, `${floor} поверх`, `floor ${floor}`)}` : ''}`;
}

/** ~10 minutes before a booking ends. `blocker` says why it can't be extended, if it can't. */
export function bookingEndingText(lang: Lang, room: string, end: Date, blocker: string | null) {
  const name = room.replace(/\s*\(.*\)\s*$/, '');
  const head = `<b>${t(lang, `Бронь закінчується о ${hm(end)}`, `Your booking ends at ${hm(end)}`)}</b>\n${escapeHtml(name)}`;
  return blocker ? `${head}\n${escapeHtml(blocker)}` : head;
}

/** After sign-up in the mini app. */
export function onboardedText(lang: Lang, digestHour: number, kyivHourNow: number) {
  if (digestHour < 0) {
    return t(lang, 'Готово. Дайджест вимкнено, а нагадування про дедлайни й перенесення пар приходитимуть одразу.', 'All set. The digest is off; deadline reminders and class changes will arrive right away.');
  }
  const at = `${String(digestHour).padStart(2, '0')}:00`;
  const today = kyivHourNow < digestHour;
  return t(lang, `Готово. Перший дайджест — ${today ? 'сьогодні' : 'завтра'} о ${at}.`, `All set. Your first digest arrives ${today ? 'today' : 'tomorrow'} at ${at}.`);
}
