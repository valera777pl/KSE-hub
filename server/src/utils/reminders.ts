import { escapeHtml } from '../bot/send.js';
import { hm, shortDay, type Lang } from '../bot/messages.js';

/** "Нагадати другу": at most this many a day from one person, so it never turns into spam. */
export const FRIEND_REMINDERS_PER_DAY = 5;
const MINUTE = 60_000;
const YEAR = 365 * 24 * 60 * MINUTE;

/** A reminder time is usable when it's at least a minute ahead and within a year. */
export function validRemindAt(at: Date, now: Date): boolean {
  const t = at.getTime();
  return Number.isFinite(t) && t >= now.getTime() + MINUTE && t <= now.getTime() + YEAR;
}

/** "пт 30.10 о 18:00" — how Copilot and the app confirm a reminder. The cron runs every 10 min, so no "exactly". */
export function reminderWhen(at: Date, lang: Lang): string {
  return lang === 'en' ? `${shortDay(at, lang)} at ${hm(at)}` : `${shortDay(at, lang)} о ${hm(at)}`;
}

/** The message a reminder arrives as. */
export function reminderText(kind: 'self' | 'friend' | 'event', text: string, lang: Lang, fromName?: string): string {
  const body = escapeHtml(text);
  if (kind === 'friend') return `<b>${escapeHtml(fromName ?? '')} ${lang === 'en' ? 'reminds you' : 'нагадує'}</b>\n${body}`;
  // "Завтра о 18:00 — Семінар з відбудови економіки\nICU Hall": the first line in bold
  if (kind === 'event') {
    const [first, ...rest] = text.split('\n');
    return [`<b>${escapeHtml(first)}</b>`, ...rest.map(escapeHtml)].join('\n');
  }
  return `<b>${lang === 'en' ? 'Reminder' : 'Нагадування'}</b>\n${body}`;
}
