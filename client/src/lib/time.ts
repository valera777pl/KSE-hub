/* Kyiv-time helpers shared by every screen. Dates from the API are ISO strings in UTC. */

import { lang, locale, tr } from './i18n';

export const TZ = 'Europe/Kyiv';
export const DAY = 86_400_000;

/** Current time; the dev mock can pin it (?now=11:45) so screens show a class in progress. */
export const now = () => new Date((import.meta.env.DEV && (window as unknown as { __MOCK_NOW__?: number }).__MOCK_NOW__) || Date.now());

/** "2026-10-27" in Kyiv */
export const dayKey = (d: Date) => new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(d);
export const todayKey = () => dayKey(now());

/** "09:30" */
export const hm = (iso: string | Date) =>
  new Intl.DateTimeFormat(locale(), { timeZone: TZ, hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).format(new Date(iso));

const noon = (key: string) => new Date(`${key}T12:00:00Z`);
export const addDays = (key: string, n: number) => new Date(noon(key).getTime() + n * DAY).toISOString().slice(0, 10);

/** Monday of the week containing `key` */
export const mondayOf = (key: string) => addDays(key, -((noon(key).getUTCDay() + 6) % 7));
export const weekOf = (key: string) => Array.from({ length: 7 }, (_, i) => addDays(mondayOf(key), i));

const fmt = (key: string, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat(locale(), { timeZone: 'UTC', ...o }).format(noon(key));
/** "Вт" */
export const weekdayShort = (key: string) => { const s = fmt(key, { weekday: 'short' }); return s.charAt(0).toUpperCase() + s.slice(1); };
/** "вівторок, 27 жовтня" */
export const dayTitle = (key: string) => fmt(key, { weekday: 'long', day: 'numeric', month: 'long' });
/** "27" */
export const dayNum = (key: string) => String(noon(key).getUTCDate());
/** "27 жовтня" */
export const dayMonth = (key: string) => fmt(key, { day: 'numeric', month: 'long' });

/** "25 хв", "1 год 10 хв", "3 дні" — a compact distance for big numbers */
export function duration(ms: number): { value: string; unit: string } {
  const min = Math.max(0, Math.round(ms / 60_000));
  // Minutes up to two hours: "65 хв" reads as a span, "1:05" would read as a clock time
  if (min < 120) return { value: String(min), unit: tr('хв', 'min') };
  const h = Math.round(min / 60);
  if (h < 48) return { value: String(h), unit: tr('год', 'h') };
  const d = Math.round(h / 24);
  return { value: String(d), unit: lang() === 'en' ? (d === 1 ? 'day' : 'days') : plural(d, 'день', 'дні', 'днів') };
}

export function plural(n: number, one: string, few: string, many: string) {
  const m10 = n % 10, m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return one;
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return few;
  return many;
}

/** "ще 35 хв", "залишилось 2 год" in running text */
export function spanText(ms: number) {
  const min = Math.max(0, Math.round(ms / 60_000));
  if (min < 120) return `${min} ${tr('хв', 'min')}`;
  const h = Math.floor(min / 60);
  if (h < 48) return `${Math.round(min / 60)} ${tr('год', 'h')}`;
  const d = Math.round(h / 24);
  return `${d} ${lang() === 'en' ? (d === 1 ? 'day' : 'days') : plural(d, 'день', 'дні', 'днів')}`;
}

/** "сьогодні", "завтра", "ср" — how far a date is, in words a student uses */
export function relDay(iso: string) {
  const key = dayKey(new Date(iso));
  const today = todayKey();
  if (key === today) return tr('сьогодні', 'today');
  if (key === addDays(today, 1)) return tr('завтра', 'tomorrow');
  return weekdayShort(key).toLowerCase();
}
