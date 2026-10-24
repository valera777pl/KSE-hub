import { kyivDate, kyivDayStart } from './kyivTime.js';

/**
 * Start and end of the Kyiv calendar day containing `date` (the 3 h/day
 * booking quota resets at midnight Kyiv, not UTC). DST days are 23/25 h long.
 */
export function getDayBounds(date: Date = new Date()): { start: Date; end: Date } {
  const day = kyivDate(date);
  const start = kyivDayStart(day);
  const next = new Date(`${day}T12:00:00Z`);
  next.setUTCDate(next.getUTCDate() + 1);
  const end = new Date(kyivDayStart(next.toISOString().slice(0, 10)).getTime() - 1);
  return { start, end };
}

/**
 * Gets the difference between two dates in hours.
 */
export function diffInHours(start: Date, end: Date): number {
  return (end.getTime() - start.getTime()) / (1000 * 60 * 60);
}

/**
 * Rounds a date up to the nearest 30-minute mark.
 */
export function roundToNext30Min(date: Date = new Date()): Date {
  const result = new Date(date);
  const minutes = result.getMinutes();
  if (minutes <= 30) {
    result.setMinutes(30, 0, 0);
  } else {
    result.setHours(result.getHours() + 1, 0, 0, 0);
  }
  return result;
}

/**
 * Format a date as "HH:MM" string.
 */
export function formatTime(date: Date): string {
  return date.toLocaleTimeString('uk-UA', { hour: '2-digit', minute: '2-digit', hour12: false });
}

/**
 * Check if a date is today.
 */
export function isToday(date: Date): boolean {
  const today = new Date();
  return (
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  );
}
