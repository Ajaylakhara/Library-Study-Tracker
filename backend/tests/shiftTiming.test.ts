import { describe, expect, it } from '@jest/globals';
import { fromZonedTime } from 'date-fns-tz';
import {
  MAX_OVERTIME_REPEATS,
  OvertimeState,
  decideOvertimeAction,
  formatShiftEndIST,
  getShiftPhase,
  istDayKey,
  minutesPastShiftEnd,
  snoozeUntil,
} from '../src/utils/shiftTiming';
import { TZ } from '../src/utils/time';

/** Build an absolute instant from an IST wall-clock time, independent of the machine's time zone. */
const ist = (local: string): Date => fromZonedTime(local, TZ);
const minutes = (date: Date, delta: number): Date => new Date(date.getTime() + delta * 60_000);

function overtimeState(overrides: Partial<OvertimeState> = {}): OvertimeState {
  const shiftEndsAt = ist('2026-03-10T11:00:00');
  return {
    shiftEndsAt,
    now: minutes(shiftEndsAt, 20),
    alertSent: false,
    overtimeAdminAlertedAt: null,
    overtimeRepeatCount: 0,
    overtimeSnoozedUntil: null,
    overtimeSnoozeAlertPending: false,
    repeatMinutes: 0,
    ...overrides,
  };
}

describe('shift phases (IST)', () => {
  const shiftEndsAt = ist('2026-03-10T11:00:00');

  it('is running until 10 minutes before the end', () => {
    expect(getShiftPhase(shiftEndsAt, ist('2026-03-10T10:49:59'))).toBe('running');
  });

  it('is "ending soon" from 10 minutes before the end until the end', () => {
    expect(getShiftPhase(shiftEndsAt, ist('2026-03-10T10:50:00'))).toBe('ending_soon');
    expect(getShiftPhase(shiftEndsAt, ist('2026-03-10T10:59:59'))).toBe('ending_soon');
  });

  it('is "ended" at the exact end time and after', () => {
    expect(getShiftPhase(shiftEndsAt, ist('2026-03-10T11:00:00'))).toBe('ended');
    expect(getShiftPhase(shiftEndsAt, ist('2026-03-10T13:00:00'))).toBe('ended');
  });

  it('shows the end time in IST', () => {
    expect(formatShiftEndIST(shiftEndsAt)).toBe('11:00 AM');
  });
});

describe('overtime alert timing', () => {
  it('does not alert before 15 minutes past the end', () => {
    const base = overtimeState();
    const state = overtimeState({ now: minutes(base.shiftEndsAt, 14) });
    expect(minutesPastShiftEnd(state.shiftEndsAt, state.now)).toBe(14);
    expect(decideOvertimeAction(state)).toBeNull();
  });

  it('sends the first alert at exactly 15 minutes past the end', () => {
    const base = overtimeState();
    expect(decideOvertimeAction(overtimeState({ now: minutes(base.shiftEndsAt, 15) }))).toBe('initial');
  });

  it('does not send the first alert twice', () => {
    const base = overtimeState();
    const alerted = overtimeState({
      alertSent: true,
      overtimeAdminAlertedAt: minutes(base.shiftEndsAt, 15),
      now: minutes(base.shiftEndsAt, 40),
    });
    expect(decideOvertimeAction(alerted)).toBeNull();
  });
});

describe('overtime snooze (15 minutes)', () => {
  it('snoozes for exactly 15 minutes', () => {
    const now = ist('2026-03-10T11:20:00');
    expect(snoozeUntil(now).getTime() - now.getTime()).toBe(15 * 60_000);
  });

  it('stays quiet while snoozed and alerts again once the snooze ends', () => {
    const base = overtimeState();
    const alertedAt = minutes(base.shiftEndsAt, 15);
    const until = snoozeUntil(minutes(base.shiftEndsAt, 20));
    const snoozed = {
      alertSent: true,
      overtimeAdminAlertedAt: alertedAt,
      overtimeSnoozedUntil: until,
      overtimeSnoozeAlertPending: true,
      overtimeRepeatCount: 0,
    };
    expect(decideOvertimeAction(overtimeState({ ...snoozed, now: minutes(until, -1) }))).toBeNull();
    expect(decideOvertimeAction(overtimeState({ ...snoozed, now: until }))).toBe('snooze');
  });
});

describe('overtime repeat alerts', () => {
  const base = overtimeState();
  const alertedAt = minutes(base.shiftEndsAt, 15);

  it('repeats after the configured interval', () => {
    const state = overtimeState({
      alertSent: true,
      overtimeAdminAlertedAt: alertedAt,
      repeatMinutes: 10,
      overtimeRepeatCount: 2,
    });
    expect(decideOvertimeAction({ ...state, now: minutes(alertedAt, 9) })).toBeNull();
    expect(decideOvertimeAction({ ...state, now: minutes(alertedAt, 10) })).toBe('repeat');
  });

  it('never repeats when OVERTIME_REPEAT_MINUTES is 0', () => {
    const state = overtimeState({
      alertSent: true,
      overtimeAdminAlertedAt: alertedAt,
      repeatMinutes: 0,
      now: minutes(alertedAt, 600),
    });
    expect(decideOvertimeAction(state)).toBeNull();
  });

  it('stops after six repeats', () => {
    expect(MAX_OVERTIME_REPEATS).toBe(6);
    const due = {
      alertSent: true,
      overtimeAdminAlertedAt: alertedAt,
      repeatMinutes: 10,
      now: minutes(alertedAt, 120),
    };
    expect(decideOvertimeAction(overtimeState({ ...due, overtimeRepeatCount: 5 }))).toBe('repeat');
    expect(decideOvertimeAction(overtimeState({ ...due, overtimeRepeatCount: 6 }))).toBeNull();
  });
});

describe('a session crossing midnight IST', () => {
  // Check-in 22:00 IST, 4-hour shift: ends 02:00 IST on the next calendar day.
  const checkInAt = ist('2026-03-10T22:00:00');
  const shiftEndsAt = new Date(checkInAt.getTime() + 4 * 60 * 60_000);

  it('ends on the next IST day and is displayed in IST', () => {
    expect(istDayKey(checkInAt)).toBe('2026-03-10');
    expect(istDayKey(shiftEndsAt)).toBe('2026-03-11');
    expect(formatShiftEndIST(shiftEndsAt)).toBe('02:00 AM');
  });

  it('runs the reminder, end and overtime rules across midnight', () => {
    expect(getShiftPhase(shiftEndsAt, ist('2026-03-10T23:59:59'))).toBe('running');
    expect(getShiftPhase(shiftEndsAt, ist('2026-03-11T01:50:00'))).toBe('ending_soon');
    expect(getShiftPhase(shiftEndsAt, ist('2026-03-11T02:00:00'))).toBe('ended');

    const at = (local: string) =>
      overtimeState({ shiftEndsAt, now: ist(local) });
    expect(decideOvertimeAction(at('2026-03-11T02:14:00'))).toBeNull();
    expect(decideOvertimeAction(at('2026-03-11T02:15:00'))).toBe('initial');
    expect(minutesPastShiftEnd(shiftEndsAt, ist('2026-03-11T03:00:00'))).toBe(60);
  });
});
