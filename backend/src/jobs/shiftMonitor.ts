import { format } from 'date-fns-tz';
import { config } from '../config';
import { Notification } from '../models/Notification';
import { Session, ISession } from '../models/Session';
import { User } from '../models/User';
import { NotificationService } from '../services/notifications/NotificationService';
import { TZ } from '../utils/time';

export interface ShiftMonitorOptions {
  sessionIds?: readonly string[];
  now?: Date;
}

export interface ShiftMonitorResult {
  processed: number;
  sessionsChecked: number;
  alertsCreated: number;
  errors: number;
}

function activeSessionFilter(session: ISession): Record<string, unknown> {
  return { _id: session._id, status: 'active' };
}

function snoozeExpiredFilter(now: Date): Record<string, unknown> {
  return {
    $or: [
      { overtimeSnoozedUntil: null },
      { overtimeSnoozedUntil: { $lte: now } },
    ],
  };
}

async function enqueueOvertimeAlert(
  session: ISession,
  student: { _id: string; name: string; phone?: string },
  seatNumber: number | string,
  minutesPastEnd: number,
  repeat: boolean,
  activeCount: number
): Promise<void> {
  const shiftEndsAtIST = format(session.shiftEndsAt, 'hh:mm a', { timeZone: TZ });
  await NotificationService.enqueueAdmin({
    type: 'overtime_admin',
    vars: {
      studentName: student.name,
      seatNumber,
      shiftEndsAt: shiftEndsAtIST,
      shiftLabel: `${session.shiftHours}-hour`,
      minutesPastEnd,
      studyingNow: activeCount,
    },
    sessionId: session._id,
    studentName: student.name,
    studentPhone: student.phone,
    repeat,
  });

  const hasLinkedAdmin = await User.exists({
    role: 'admin',
    status: 'approved',
    isDeleted: false,
    telegramChatId: { $type: 'string' },
  });
  if (!hasLinkedAdmin) {
    await Notification.updateMany(
      { sessionId: session._id, type: 'overtime_admin', channel: 'inapp' },
      { $set: { warning: 'No admin Telegram linked' } }
    );
  }
}

export async function runShiftMonitor(options: ShiftMonitorOptions = {}): Promise<ShiftMonitorResult> {
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
    errors: 0,
  };

  for (const session of sessions) {
    const student = session.student as unknown as {
      _id: string;
      name: string;
      phone?: string;
      isDeleted?: boolean;
    } | null;
    const seat = session.seat as unknown as { number: number } | null;
    if (!student || !seat || student.isDeleted) continue;

    try {
      const shiftEndsAt = session.shiftEndsAt;
      const shiftEndsAtIST = format(shiftEndsAt, 'hh:mm a', { timeZone: TZ });
      const reminderDueAt = new Date(shiftEndsAt.getTime() - 10 * 60_000);
      if (now >= reminderDueAt && now < shiftEndsAt) {
        const claimed = await Session.findOneAndUpdate(
          {
            ...activeSessionFilter(session),
            shiftEndsAt: { $gt: now },
            'alertsSent.shiftReminder': { $ne: true },
          },
          { $set: { 'alertsSent.shiftReminder': true } },
          { new: true }
        );
        if (claimed) {
          try {
            await NotificationService.enqueue({
              userId: student._id,
              type: 'shift_reminder',
              vars: { name: student.name, shiftEndsAt: shiftEndsAtIST },
              sessionId: session._id,
              studentNameSnapshot: student.name,
              studentPhoneSnapshot: student.phone,
            });
            result.alertsCreated++;
          } catch (error) {
            await Session.updateOne(
              { _id: session._id, status: 'active' },
              { $set: { 'alertsSent.shiftReminder': false } }
            );
            throw error;
          }
        }
      }

      if (now >= shiftEndsAt) {
        const claimed = await Session.findOneAndUpdate(
          {
            ...activeSessionFilter(session),
            shiftEndsAt: { $lte: now },
            'alertsSent.shiftEnd': { $ne: true },
          },
          { $set: { 'alertsSent.shiftEnd': true } },
          { new: true }
        );
        if (claimed) {
          try {
            await NotificationService.enqueue({
              userId: student._id,
              type: 'shift_ended',
              vars: { name: student.name, shiftEndsAt: shiftEndsAtIST },
              sessionId: session._id,
              studentNameSnapshot: student.name,
              studentPhoneSnapshot: student.phone,
            });
            result.alertsCreated++;
          } catch (error) {
            await Session.updateOne(
              { _id: session._id, status: 'active' },
              { $set: { 'alertsSent.shiftEnd': false } }
            );
            throw error;
          }
        }
      }

      const minutesPastEnd = Math.floor((now.getTime() - shiftEndsAt.getTime()) / 60_000);
      if (minutesPastEnd < 15) continue;

      const snoozePending = session.overtimeSnoozeAlertPending === true &&
        !!session.overtimeSnoozedUntil &&
        session.overtimeSnoozedUntil <= now;
      const lastAlertAt = session.overtimeAdminAlertedAt;
      const repeatDue = !!lastAlertAt &&
        config.overtimeRepeatMinutes > 0 &&
        (session.overtimeRepeatCount ?? 0) < 6 &&
        now.getTime() - lastAlertAt.getTime() >= config.overtimeRepeatMinutes * 60_000;
      const initialDue = !lastAlertAt && session.alertsSent?.overtime !== true;
      if (!initialDue && !repeatDue && !snoozePending) continue;
      if ((session.overtimeRepeatCount ?? 0) >= 6) continue;

      const claimFilter: Record<string, unknown> = {
        ...activeSessionFilter(session),
        shiftEndsAt: { $lte: new Date(now.getTime() - 15 * 60_000) },
        ...snoozeExpiredFilter(now),
      };
      if (initialDue) {
        claimFilter.overtimeAdminAlertedAt = null;
        claimFilter['alertsSent.overtime'] = { $ne: true };
      } else {
        claimFilter.overtimeAdminAlertedAt = lastAlertAt;
        claimFilter.overtimeRepeatCount = session.overtimeRepeatCount ?? 0;
        if (!snoozePending) {
          claimFilter.overtimeAdminAlertedAt = {
            $lte: new Date(now.getTime() - config.overtimeRepeatMinutes * 60_000),
          };
        } else {
          claimFilter.overtimeSnoozeAlertPending = true;
          claimFilter.overtimeSnoozedUntil = { $lte: now };
        }
      }

      const claimed = await Session.findOneAndUpdate(
        claimFilter,
        {
          $set: {
            'alertsSent.overtime': true,
            overtimeAdminAlertedAt: now,
            overtimeSnoozeAlertPending: false,
            ...(initialDue ? { overtimeRepeatCount: session.overtimeRepeatCount ?? 0 } : {}),
          },
          ...(!initialDue ? { $inc: { overtimeRepeatCount: 1 } } : {}),
        },
        { new: true }
      );
      if (!claimed) continue;

      try {
        await enqueueOvertimeAlert(
          session,
          student,
          seat.number,
          minutesPastEnd,
          !initialDue,
          sessions.length
        );
        result.alertsCreated++;
      } catch (error) {
        await Session.updateOne(
          { _id: session._id, overtimeAdminAlertedAt: now },
          initialDue
            ? {
                $set: { overtimeAdminAlertedAt: null, 'alertsSent.overtime': false },
              }
            : {
                $set: {
                  overtimeAdminAlertedAt: lastAlertAt,
                  overtimeSnoozeAlertPending: snoozePending,
                },
                $inc: { overtimeRepeatCount: -1 },
              }
        );
        throw error;
      }
    } catch (error) {
      result.errors++;
      console.error(`[ShiftMonitor] Session processing failed (${error instanceof Error ? error.name : 'UnknownError'}).`);
    }
  }

  console.info(
    `[ShiftMonitor] Run complete: checked=${result.sessionsChecked}, alerts=${result.alertsCreated}, errors=${result.errors}.`
  );
  return result;
}
