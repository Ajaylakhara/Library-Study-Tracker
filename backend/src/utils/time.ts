import { toZonedTime, fromZonedTime, format } from 'date-fns-tz';

export const TZ = 'Asia/Kolkata';

/** Current time in IST */
export function nowIST(): Date {
  return toZonedTime(new Date(), TZ);
}

/** Format a date as 'YYYY-MM' in IST */
export function toMonthString(date: Date): string {
  return format(toZonedTime(date, TZ), 'yyyy-MM', { timeZone: TZ });
}

/** Get the first day of a given month (IST) as a UTC Date */
export function startOfMonthIST(yearMonth: string): Date {
  const [year, month] = yearMonth.split('-').map(Number);
  // midnight IST = start of day in Asia/Kolkata
  return fromZonedTime(new Date(year, month - 1, 1, 0, 0, 0, 0), TZ);
}

/** Get the last day of a given month (IST) 23:59:59 as a UTC Date */
export function endOfMonthIST(yearMonth: string): Date {
  const [year, month] = yearMonth.split('-').map(Number);
  const lastDay = new Date(year, month, 0).getDate();
  return fromZonedTime(new Date(year, month - 1, lastDay, 23, 59, 59, 999), TZ);
}

/** Previous month string from now (IST) */
export function previousMonthString(): string {
  const ist = toZonedTime(new Date(), TZ);
  ist.setMonth(ist.getMonth() - 1);
  return format(ist, 'yyyy-MM', { timeZone: TZ });
}

/** Format duration in minutes to "Xh Ym" */
export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** Calculate duration in minutes between two dates */
export function diffMinutes(start: Date, end: Date): number {
  return Math.floor((end.getTime() - start.getTime()) / 60000);
}
