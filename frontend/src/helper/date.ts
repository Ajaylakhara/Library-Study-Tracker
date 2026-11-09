const TZ = 'Asia/Kolkata';

const timeFmt = new Intl.DateTimeFormat('en-IN', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: true });
const dateFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: '2-digit', month: 'short', year: 'numeric' });
const dayMonthFmt = new Intl.DateTimeFormat('en-GB', { timeZone: TZ, day: '2-digit', month: 'short' });
const dowFmt = new Intl.DateTimeFormat('en-US', { timeZone: TZ, weekday: 'short' });
const ymdFmt = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' });

export const clock = (iso: string | Date) => timeFmt.format(new Date(iso)).toUpperCase();
export const dateLabel = (iso: string | Date) => dateFmt.format(new Date(iso));
export const dayMonth = (iso: string | Date) => dayMonthFmt.format(new Date(iso));
export const dayOfWeek = (iso: string | Date) => dowFmt.format(new Date(iso));
export const dateTimeLabel = (iso: string | Date) => `${dayMonth(iso)} · ${clock(iso)}`;
/** YYYY-MM-DD in IST */
export const ymd = (iso: string | Date) => ymdFmt.format(new Date(iso));

/** Current month in IST as YYYY-MM */
export function currentMonth(): string {
  return ymd(new Date()).slice(0, 7);
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

export function monthLabel(month: string, withYear = true): string {
  const [y, m] = month.split('-').map(Number);
  const name = new Intl.DateTimeFormat('en-GB', { month: 'long', timeZone: 'UTC' }).format(new Date(Date.UTC(y, m - 1, 1)));
  return withYear ? `${name} ${y}` : name;
}

export function daysInMonth(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

/** 0 = Monday … 6 = Sunday: weekday of the 1st of the month */
export function firstWeekdayMon0(month: string): number {
  const [y, m] = month.split('-').map(Number);
  return (new Date(Date.UTC(y, m - 1, 1)).getUTCDay() + 6) % 7;
}

/** ISO range covering a whole IST month (used by /admin/reports/summary) */
export function monthRangeISO(month: string): { from: string; to: string } {
  const [y, m] = month.split('-').map(Number);
  const IST = 5.5 * 3600 * 1000;
  const from = new Date(Date.UTC(y, m - 1, 1) - IST);
  const to = new Date(Date.UTC(y, m, 1) - IST - 1);
  return { from: from.toISOString(), to: to.toISOString() };
}

export const NOTIFICATION_LABELS: Record<string, string> = {
  approved: 'Account approved',
  rejected: 'Account rejected',
  shift_reminder: 'Shift ending',
  shift_ended: 'Shift ended',
  auto_checkout: 'Auto check-out',
  fee_unpaid: 'Fee due',
  overtime_admin: 'Overtime',
  fee_generated_admin: 'Fees generated',
};
