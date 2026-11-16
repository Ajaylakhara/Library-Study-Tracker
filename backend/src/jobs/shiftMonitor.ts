import { config } from '../config';
import { Notification } from '../models/Notification';
import { Session, ISession } from '../models/Session';
import { NotificationService } from '../services/notifications/NotificationService';
import { logEvent } from '../utils/logger';
import {
  OVERTIME_ALERT_AFTER_MINUTES,
  OvertimeAction,
  decideOvertimeAction,
  formatShiftEndIST,
  getShiftPhase,
  minutesPastShiftEnd,
} from '../utils/shiftTiming';

export interface ShiftMonitorOptions {
  sessionIds?: readonly string[];
  now?: Date;
  /** Stop starting new sessions once this much time has passed (serverless time budget). */
  maxDurationMs?: number;
}

export interface ShiftMonitorResult {
  processed: number;
  sessionsChecked: number;
  alertsCreated: number;
  /** Notification records created or refreshed for delivery by this run. */
  notificationsQueued: number;
  errors: number;
  /** True when the time budget ended the run early; remaining sessions are handled next tick. */
  timedOut: boolean;
}

export const NO_ADMIN_TELEGRAM_WARNING =
  'Telegram alert NOT sent: no admin has Telegram linked. Link an admin Telegram account on the Alerts page.';
export const NO_ADMIN_ACCOUNT_WARNING =
  'Telegram alert NOT sent: no active admin account was found.';

interface MonitoredStudent {
  _id: string;
  name: string;
  phone?: string;
  isDeleted?: boolean;
}

function snoozeExpiredFilter(now: Date): Record<string, unknown> {
  return {
    $or: [{ overtimeSnoozedUntil: null }, { overtimeSnoozedUntil: { $lte: now } }],
  };
}

/**
 * Create the admin overtime notification records. Throws if a real database
 * error occurs, so the caller does not mark the alert as sent.
 */
async function enqueueOvertimeAlert(
  session: ISession,
  student: MonitoredStudent,
  seatNumber: number | string,
  minutesPastEnd: number,
  repeat: boolean,
  activeCount: number
): Promise<number> {
  const summary = await NotificationService.enqueueAdmin({
    type: 'overtime_admin',
    vars: {
      studentName: student.name,
      seatNumber,
      shiftEndsAt: formatShiftEndIST(session.shiftEndsAt),
      shiftLabel: `${session.shiftHours}-hour`,
      minutesPastEnd,
      studyingNow: activeCount,
    },
    sessionId: session._id,
    studentName: student.name,
    studentPhone: student.phone,
    repeat,
    strict: true,
  });

  if (summary.adminsWithTelegram === 0) {
    // Nothing can reach Telegram: say so on the in-app alert instead of failing silently.
    const warning = summary.admins === 0 ? NO_ADMIN_ACCOUNT_WARNING : NO_ADMIN_TELEGRAM_WARNING;
    await Notification.updateMany(
      { sessionId: session._id, type: 'overtime_admin', channel: 'inapp' },
      { $set: { warning } }
    );
    logEvent('warn', 'overtime_no_admin_telegram', {
      sessionId: String(session._id),
      admins: summary.admins,
    });
  }
  return summary.created + summary.refreshed;
}

/**
 * Queue a student shift alert, and only afterwards mark it as done on the session.
 * The unique notification index makes a repeated attempt a harmless no-op.
 */
async function queueStudentAlert(
  session: ISession,
  student: MonitoredStudent,
  type: 'shift_reminder' | 'shift_ended',
  flag: 'shiftReminder' | 'shiftEnd',
  result: ShiftMonitorResult
): Promise<void> {
  const summary = await NotificationService.enqueue({
    userId: student._id,
    type,
    vars: { name: student.name, shiftEndsAt: formatShiftEndIST(session.shiftEndsAt) },
    sessionId: session._id,
    studentNameSnapshot: student.name,
    studentPhoneSnapshot: student.phone,
    strict: true,
  });
  await Session.updateOne(
    { _id: session._id, status: 'active', [`alertsSent.${flag}`]: { $ne: true } },
    { $set: { [`alertsSent.${flag}`]: true } }
  );
  result.notificationsQueued += summary.created;
  if (summary.created > 0) result.alertsCreated++;
}

function overtimeClaimFilter(
  session: ISession,
  action: Exclude<OvertimeAction, null>,
  now: Date
): Record<string, unknown> {
  const filter: Record<string, unknown> = {
    _id: session._id,
    status: 'active',
    shiftEndsAt: { $lte: new Date(now.getTime() - OVERTIME_ALERT_AFTER_MINUTES * 60_000) },
    ...snoozeExpiredFilter(now),
  };
  if (action === 'initial') {
    filter.overtimeAdminAlertedAt = null;
    filter['alertsSent.overtime'] = { $ne: true };
    return filter;
  }
  filter.overtimeRepeatCount = session.overtimeRepeatCount ?? 0;
  if (action === 'snooze') {
    filter.overtimeAdminAlertedAt = session.overtimeAdminAlertedAt;
    filter.overtimeSnoozeAlertPending = true;
    filter.overtimeSnoozedUntil = { $lte: now };
  } else {
    filter.overtimeAdminAlertedAt = {
      $lte: new Date(now.getTime() - config.overtimeRepeatMinutes * 60_000),
    };
  }
  return filter;
}

export async function runShiftMonitor(options: ShiftMonitorOptions = {}): Promise<ShiftMonitorResult> {
  const startedAt = Date.now();
  const now = options.now ?? new Date();
  const query: Record<string, unknown> = { status: 'active' };
  if (options.sessionIds !== undefined) query._id = { $in: options.sessionIds };

  const sessions = await Session.find(query)
    .populate('student', 'name phone isDeleted')
    .populate('seat', 'number');
  const result: ShiftMonitorResult = {
    processed: sessions.length,
    sessionsChecked: sessions.length,
    alertsCreated: 0,
    notificationsQueued: 0,
    errors: 0,
    timedOut: false,
  };

  for (const session of sessions) {
    if (options.maxDurationMs !== undefined && Date.now() - startedAt >= options.maxDurationMs) {
      result.timedOut = true;
      logEvent('warn', 'shift_monitor_time_budget_reached', {
        budgetMs: options.maxDurationMs,
        sessionsChecked: sessions.length,
      });
      break;
    }

    const student = session.student as unknown as MonitoredStudent | null;
    const seat = session.seat as unknown as { number: number } | null;
    if (!student || !seat || student.isDeleted) continue;

    try {
      const phase = getShiftPhase(session.shiftEndsAt, now);

      if (phase === 'ending_soon' && session.alertsSent?.shiftReminder !== true) {
        await queueStudentAlert(session, student, 'shift_reminder', 'shiftReminder', result);
      }
      if (phase === 'ended' && session.alertsSent?.shiftEnd !== true) {
        await queueStudentAlert(session, student, 'shift_ended', 'shiftEnd', result);
      }

      const action = decideOvertimeAction({
        shiftEndsAt: session.shiftEndsAt,
        now,
        alertSent: session.alertsSent?.overtime === true,
        overtimeAdminAlertedAt: session.overtimeAdminAlertedAt ?? null,
        overtimeRepeatCount: session.overtimeRepeatCount ?? 0,
        overtimeSnoozedUntil: session.overtimeSnoozedUntil ?? null,
        overtimeSnoozeAlertPending: session.overtimeSnoozeAlertPending === true,
        repeatMinutes: config.overtimeRepeatMinutes,
      });
      if (!action) continue;

      // 1) Create the notification records first. A failure throws and leaves the
      //    session untouched, so the next tick tries again.
      const queued = await enqueueOvertimeAlert(
        session,
        student,
        seat.number,
        minutesPastShiftEnd(session.shiftEndsAt, now),
        action !== 'initial',
        sessions.length
      );
      result.notificationsQueued += queued;

      // 2) Only now mark the alert as handled (atomic, so overlapping runs count it once).
      const claimed = await Session.findOneAndUpdate(
        overtimeClaimFilter(session, action, now),
        {
          $set: {
            'alertsSent.overtime': true,
            overtimeAdminAlertedAt: now,
            overtimeSnoozeAlertPending: false,
          },
          ...(action !== 'initial' ? { $inc: { overtimeRepeatCount: 1 } } : {}),
        },
        { new: true }
      );
      if (claimed) result.alertsCreated++;
    } catch (error) {
      result.errors++;
      logEvent('error', 'shift_monitor_session_failed', { sessionId: String(session._id) }, error);
    }
  }

  logEvent('info', 'shift_monitor_run_complete', {
    checked: result.sessionsChecked,
    alertsCreated: result.alertsCreated,
    notificationsQueued: result.notificationsQueued,
    errors: result.errors,
    timedOut: result.timedOut,
    durationMs: Date.now() - startedAt,
  });
  return result;
}
