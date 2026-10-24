const TZ = 'Europe/Kyiv';

const dateTimeFmt = new Intl.DateTimeFormat('uk-UA', {
  timeZone: TZ,
  weekday: 'short',
  day: 'numeric',
  month: 'short',
  hour: '2-digit',
  minute: '2-digit',
});

const hourFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', hourCycle: 'h23' });

/** "пт, 24 жовт., 23:59" */
export function formatKyiv(date: Date): string {
  return dateTimeFmt.format(date);
}

/** 0 = Sunday … 6 = Saturday, in Kyiv. */
export function kyivWeekday(now = new Date()): number {
  return new Date(`${kyivDate(now)}T12:00:00Z`).getUTCDay();
}

/** Current hour (0–23) in Kyiv. */
export function kyivHour(now = new Date()): number {
  return parseInt(hourFmt.format(now), 10);
}

/** "через 5 год", "через 2 дн." */
export function timeLeft(date: Date, now = new Date()): string {
  const hours = Math.round((date.getTime() - now.getTime()) / 3_600_000);
  if (hours < 1) return 'менше години';
  if (hours < 48) return `через ${hours} год`;
  return `через ${Math.round(hours / 24)} дн.`;
}

/** "п'ятниця, 23 жовтня 2026 р. о 23:05 (UTC+03:00, сьогодні 2026-10-23)" — for the assistant's prompt. */
export function kyivNowForPrompt(now = new Date()): string {
  const human = new Intl.DateTimeFormat('uk-UA', {
    timeZone: TZ, weekday: 'long', day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  }).format(now);
  const isoDate = new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(now);
  const offset = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'longOffset' })
    .formatToParts(now).find((p) => p.type === 'timeZoneName')?.value.replace('GMT', 'UTC') ?? 'UTC+02:00';
  return `${human} (${offset}, сьогодні ${isoDate})`;
}

/** "+03:00" / "+02:00" for the given instant in Kyiv. */
function kyivOffset(at: Date): string {
  const name = new Intl.DateTimeFormat('en-US', { timeZone: TZ, timeZoneName: 'longOffset' })
    .formatToParts(at).find((p) => p.type === 'timeZoneName')?.value ?? 'GMT+02:00';
  return name === 'GMT' ? '+00:00' : name.replace('GMT', '');
}

/** "2026-10-24" — the calendar date in Kyiv. */
export function kyivDate(at = new Date()): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(at);
}

/** 00:00 Kyiv on the given "YYYY-MM-DD". */
export function kyivDayStart(day: string): Date {
  return new Date(`${day}T00:00:00${kyivOffset(new Date(`${day}T12:00:00Z`))}`);
}

/** Monday 00:00 Kyiv of the week containing `date` ("YYYY-MM-DD" or an instant). */
export function kyivWeekStart(date: string | Date = new Date()): Date {
  const day = typeof date === 'string' ? date : kyivDate(date);
  const noon = new Date(`${day}T12:00:00Z`);
  const shift = (noon.getUTCDay() + 6) % 7; // Mon=0 … Sun=6
  const monday = new Date(noon.getTime() - shift * 86_400_000).toISOString().slice(0, 10);
  return kyivDayStart(monday);
}
