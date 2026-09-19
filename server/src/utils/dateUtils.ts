/**
 * Returns the start and end of a given day in UTC.
 */
export function getDayBounds(date: Date = new Date()): { start: Date; end: Date } {
  const start = new Date(date);
  start.setUTCHours(0, 0, 0, 0);
  const end = new Date(date);
  end.setUTCHours(23, 59, 59, 999);
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
