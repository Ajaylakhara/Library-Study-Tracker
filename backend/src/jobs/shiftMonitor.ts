import { Session } from '../models/Session';
import { NotificationService } from '../services/notifications/NotificationService';
import { format } from 'date-fns-tz';
import { TZ } from '../utils/time';

export interface ShiftMonitorOptions {
  sessionIds?: readonly string[];
}

/**
 * Shift monitor: runs every minute.
 * Idempotent: uses alertsSent flags so each alert fires exactly once.
 * Note: Per business rules, there is NO auto-checkout. Sessions remain active in overtime.
 */
export async function runShiftMonitor(options: ShiftMonitorOptions = {}): Promise<void> {
  const now = new Date();

  // Fetch all active sessions
  const query: Record<string, unknown> = { status: 'active' };
  if (options.sessionIds !== undefined) {
    query._id = { $in: options.sessionIds };
  }
  const activeSessions = await Session.find(query)
    .populate('student', 'name phone whatsappOptIn smsOptIn preferredChannel')
    .populate('seat', 'number');

  for (const session of activeSessions) {
    const student = session.student as unknown as {
      _id: string;
      name: string;
      phone: string;
      isDeleted?: boolean;
    } | null;
    const seat = session.seat as unknown as { number: number } | null;

    if (!student || !seat || student.isDeleted) continue;

    const shiftEndsAt = session.shiftEndsAt;
    const msToEnd = shiftEndsAt.getTime() - now.getTime();
    const minutesToEnd = msToEnd / 60000;
    const minutesPastEnd = -minutesToEnd;
    const shiftEndsAtIST = format(shiftEndsAt, 'hh:mm a', { timeZone: TZ });

    // 1. Shift reminder: 10 min before end (sent once to student)
    if (!session.alertsSent.shiftReminder && minutesToEnd <= 10 && minutesToEnd > 0) {
      await NotificationService.enqueue({
        userId: student._id,
        type: 'shift_reminder',
        vars: { name: student.name, shiftEndsAt: shiftEndsAtIST },
        sessionId: session._id,
        studentNameSnapshot: student.name,
        studentPhoneSnapshot: student.phone,
      });
      await Session.findByIdAndUpdate(session._id, { 'alertsSent.shiftReminder': true });
    }

    // 2. Shift ended: at shiftEndsAt (sent once to student)
    if (!session.alertsSent.shiftEnd && minutesPastEnd >= 0) {
      await NotificationService.enqueue({
        userId: student._id,
        type: 'shift_ended',
        vars: { name: student.name, shiftEndsAt: shiftEndsAtIST },
        sessionId: session._id,
        studentNameSnapshot: student.name,
        studentPhoneSnapshot: student.phone,
      });
      await Session.findByIdAndUpdate(session._id, { 'alertsSent.shiftEnd': true });
    }

    if (!session.alertsSent.overtime && minutesPastEnd >= 15) {
      await NotificationService.enqueueAdmin({
        type: 'overtime_admin',
        vars: {
          studentName: student.name,
          seatNumber: seat.number,
          shiftEndsAt: shiftEndsAtIST,
          shiftLabel: `${session.shiftHours}-hour`,
          minutesPastEnd: Math.floor(minutesPastEnd),
          studyingNow: activeSessions.length,
        },
        sessionId: session._id,
        studentName: student.name,
        studentPhone: student.phone,
        manualStudentId: student._id,
      });
      await Session.findByIdAndUpdate(session._id, { 'alertsSent.overtime': true });
    }
  }
}
