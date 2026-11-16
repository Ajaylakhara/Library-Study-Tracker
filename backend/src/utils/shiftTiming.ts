import { formatIST } from './time';

/**
 * Pure shift/overtime rules. Session times are stored as absolute UTC instants,
 * so every comparison here is instant-based and independent of the server's
 * local time zone. IST is used only to display times (and to name the IST day).
 */

export const REMINDER_LEAD_MINUTES = 10;
export const OVERTIME_ALERT_AFTER_MINUTES = 15;
export const OVERTIME_SNOOZE_MINUTES = 15;
export const MAX_OVERTIME_REPEATS = 6;

export type ShiftPhase = 'running' | 'ending_soon' | 'ended';

export function minutesPastShiftEnd(shiftEndsAt: Date, now: Date): number {
  return Math.floor((now.getTime() - shiftEndsAt.getTime()) / 60_000);
}

export function getShiftPhase(shiftEndsAt: Date, now: Date): ShiftPhase {
  if (now.getTime() >= shiftEndsAt.getTime()) return 'ended';
  const reminderDueAt = shiftEndsAt.getTime() - REMINDER_LEAD_MINUTES * 60_000;
  return now.getTime() >= reminderDueAt ? 'ending_soon' : 'running';
}

/** Shift end as shown to people, e.g. "02:00 AM", always in IST. */
export function formatShiftEndIST(shiftEndsAt: Date): string {
  return formatIST(shiftEndsAt, 'hh:mm a');
}

/** Calendar day in IST (yyyy-MM-dd); differs from the check-in day when a shift crosses midnight IST. */
export function istDayKey(date: Date): string {
  return formatIST(date, 'yyyy-MM-dd');
}

/** When the next snooze ends if an admin snoozes at `now`. */
export function snoozeUntil(now: Date): Date {
  return new Date(now.getTime() + OVERTIME_SNOOZE_MINUTES * 60_000);
}

export interface OvertimeState {
  shiftEndsAt: Date;
  now: Date;
  /** Session.alertsSent.overtime */
  alertSent: boolean;
  overtimeAdminAlertedAt: Date | null;
  overtimeRepeatCount: number;
  overtimeSnoozedUntil: Date | null;
  overtimeSnoozeAlertPending: boolean;
  /** OVERTIME_REPEAT_MINUTES (0 disables repeats). */
  repeatMinutes: number;
}

export type OvertimeAction = 'initial' | 'snooze' | 'repeat' | null;

/** Decide which (if any) overtime admin alert is due right now. */
export function decideOvertimeAction(state: OvertimeState): OvertimeAction {
  const { now } = state;
  if (minutesPastShiftEnd(state.shiftEndsAt, now) < OVERTIME_ALERT_AFTER_MINUTES) return null;
  if (state.overtimeRepeatCount >= MAX_OVERTIME_REPEATS) return null;
  if (state.overtimeSnoozedUntil && state.overtimeSnoozedUntil.getTime() > now.getTime()) return null;

  const lastAlertAt = state.overtimeAdminAlertedAt;
  if (!lastAlertAt && !state.alertSent) return 'initial';

  if (state.overtimeSnoozeAlertPending && state.overtimeSnoozedUntil) return 'snooze';

  const repeatDue =
    !!lastAlertAt &&
    state.repeatMinutes > 0 &&
    now.getTime() - lastAlertAt.getTime() >= state.repeatMinutes * 60_000;
  return repeatDue ? 'repeat' : null;
}
