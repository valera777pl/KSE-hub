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
