import { courseCode, courseLabel, hm, kyivDay, shortDay, shortPlace, type Lang } from '../bot/messages.js';

/*
 * The pinned message in the bot chat: one short line, the first thing seen at the top of the chat
 * (owner, 2026-10-29: «все коротко, типо просто пара, наприклад наступна»).
 */

export type PinClass = { courseCode: string; section: string | null; location: string | null; startAt: Date; endAt: Date };
export type PinDeadline = { title: string; courseName: string | null; dueDate: Date };

const t = (lang: Lang, uk: string, en: string) => (lang === 'en' ? en : uk);
const place = (c: PinClass, lang: Lang) => { const p = shortPlace(c.location, lang); return p ? ` · ${p}` : ''; };
const daysBetween = (a: Date, b: Date) => Math.round((Date.parse(kyivDay(b)) - Date.parse(kyivDay(a))) / 86_400_000);
const plural = (n: number, one: string, few: string, many: string) => {
  const m10 = n % 10, m100 = n % 100;
  return m10 === 1 && m100 !== 11 ? one : m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14) ? few : many;
};

/** «Зараз: MATH101 [P8] до 12:50 · M. Shpaka 3» / «Далі: … о 11:30 · …» / «Завтра: … о 10:00 · …» */
export function nextClassLine(classes: PinClass[], now: Date, lang: Lang): string {
  const live = classes.find((c) => c.startAt <= now && now < c.endAt);
  if (live) return `${t(lang, 'Зараз', 'Now')}: ${courseLabel(live.courseCode, live.section)} ${t(lang, 'до', 'until')} ${hm(live.endAt)}${place(live, lang)}`;
  const next = classes.filter((c) => c.startAt > now).sort((a, b) => a.startAt.getTime() - b.startAt.getTime())[0];
  if (!next) return t(lang, 'Пар найближчим часом немає', 'No classes coming up');
  const d = daysBetween(now, next.startAt);
  const when = d === 0 ? t(lang, 'Далі', 'Next') : d === 1 ? t(lang, 'Завтра', 'Tomorrow') : shortDay(next.startAt, lang).replace(/^./, (c) => c.toUpperCase());
  return `${when}: ${courseLabel(next.courseCode, next.section)} ${t(lang, 'о', 'at')} ${hm(next.startAt)}${place(next, lang)}`;
}

/** «Дедлайн: ECON100 Problem set 4 — пт 30.10, 23:59» */
export function nextDeadlineLine(deadlines: PinDeadline[], now: Date, lang: Lang): string {
  const next = deadlines.filter((d) => d.dueDate > now).sort((a, b) => a.dueDate.getTime() - b.dueDate.getTime())[0];
  if (!next) return t(lang, 'Дедлайнів найближчим часом немає', 'Nothing due soon');
  const what = [courseCode(next.courseName), next.title].filter(Boolean).join(' ');
  return `${t(lang, 'Дедлайн', 'Due')}: ${what} — ${shortDay(next.dueDate, lang)}, ${hm(next.dueDate)}`;
}

/** «Сьогодні: 2 пари · 1 дедлайн»; once today's classes are over — tomorrow: «Завтра: 3 пари · перша о 10:00» */
export function dayLine(classes: PinClass[], deadlines: PinDeadline[], now: Date, lang: Lang): string {
  const today = kyivDay(now);
  const left = classes.filter((c) => kyivDay(c.startAt) === today && c.endAt > now);
  const due = deadlines.filter((d) => kyivDay(d.dueDate) === today && d.dueDate > now);
  const parts = (n: number, m: number) => [
    n ? `${n} ${lang === 'en' ? (n === 1 ? 'class' : 'classes') : plural(n, 'пара', 'пари', 'пар')}` : null,
    m ? `${m} ${lang === 'en' ? (m === 1 ? 'deadline' : 'deadlines') : plural(m, 'дедлайн', 'дедлайни', 'дедлайнів')}` : null,
  ].filter(Boolean).join(' · ');
  if (left.length || due.length) return `${t(lang, 'Сьогодні', 'Today')}: ${parts(left.length, due.length)}`;
  const tomorrow = kyivDay(new Date(now.getTime() + 86_400_000));
  const tc = classes.filter((c) => kyivDay(c.startAt) === tomorrow).sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
  const td = deadlines.filter((d) => kyivDay(d.dueDate) === tomorrow);
  if (!tc.length && !td.length) return t(lang, 'Сьогодні й завтра вільно', 'Free today and tomorrow');
  const first = tc[0] ? ` · ${t(lang, 'перша о', 'first at')} ${hm(tc[0].startAt)}` : '';
  return `${t(lang, 'Завтра', 'Tomorrow')}: ${parts(tc.length, td.length)}${first}`;
}
