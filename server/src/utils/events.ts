import { hm, kyivDay, shortDay, type Lang } from '../bot/messages.js';
import { kyivDayStart } from './kyivTime.js';

const HOUR = 3_600_000;
/** «Нагадати за день» arrives the day before, around this Kyiv hour (owner's choice, 2026-10-28). */
export const EVENT_REMIND_HOUR = 10;

/** "2026-10-30T18:00" (Kyiv wall clock, as the model writes it) → the instant. */
export function parseKyivLocal(raw: unknown): Date | null {
  const m = typeof raw === 'string' ? raw.match(/^(\d{4}-\d{2}-\d{2})[T ](\d{2}):(\d{2})/) : null;
  if (!m) return null;
  const at = new Date(kyivDayStart(m[1]).getTime() + (Number(m[2]) * 60 + Number(m[3])) * 60_000);
  return Number.isNaN(at.getTime()) ? null : at;
}

/**
 * A mailing for everyone (students@, a list, bulk, or the student only in Bcc) vs a personal invitation.
 * Mailings become events for all students; a personal invite stays with its recipient.
 */
export function isMassMailing(h: { to: string; cc: string; listId: string; precedence: string }, myEmail: string): boolean {
  if (h.listId || /bulk|list/i.test(h.precedence)) return true;
  const recipients = `${h.to} ${h.cc}`.toLowerCase();
  if (/\bstudents?@kse\.org\.ua/.test(recipients)) return true;
  return !recipients.includes(myEmail.toLowerCase());
}

/**
 * When «Нагадати за день» fires: 10:00 Kyiv the day before. Already past (the event is today or tomorrow morning)
 * → in a couple of minutes, as long as the event is 2+ hours away; otherwise there's nothing to remind.
 */
export function eventRemindAt(start: Date, now: Date): Date | null {
  const dayBefore = kyivDay(new Date(start.getTime() - 24 * HOUR));
  const at = new Date(kyivDayStart(dayBefore).getTime() + EVENT_REMIND_HOUR * HOUR);
  if (at.getTime() > now.getTime() + 60_000) return at;
  return start.getTime() - now.getTime() >= 2 * HOUR ? new Date(now.getTime() + 2 * 60_000) : null;
}

/** "Завтра о 18:00 — Семінар з відбудови економіки\nICU Hall", worded for the day it arrives. */
export function eventReminderText(e: { title: string; startsAt: Date; location: string | null }, sendAt: Date, lang: Lang): string {
  const days = Math.round((Date.parse(kyivDay(e.startsAt)) - Date.parse(kyivDay(sendAt))) / (24 * HOUR));
  const when = days === 0 ? (lang === 'en' ? `Today at ${hm(e.startsAt)}` : `Сьогодні о ${hm(e.startsAt)}`)
    : days === 1 ? (lang === 'en' ? `Tomorrow at ${hm(e.startsAt)}` : `Завтра о ${hm(e.startsAt)}`)
    : lang === 'en' ? `${shortDay(e.startsAt, lang)} at ${hm(e.startsAt)}` : `${shortDay(e.startsAt, lang)} о ${hm(e.startsAt)}`;
  return `${when} — ${e.title}${e.location ? `\n${e.location}` : ''}`;
}
