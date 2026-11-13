import mongoose from 'mongoose';
import { format } from 'date-fns-tz';
import { Notification } from '../../models/Notification';
import { Session } from '../../models/Session';
import { createError } from '../../middleware/errorHandler';
import { NotificationService } from './NotificationService';
import { getLibraryNameOrDefault } from '../librarySettings';
import { TZ } from '../../utils/time';

export async function resolveOvertimeAlerts(sessionId: mongoose.Types.ObjectId): Promise<void> {
  try {
    await Notification.updateMany(
      {
        sessionId,
        type: 'overtime_admin',
        $or: [
          { actionStatus: { $in: ['open', 'contacted'] } },
          { actionStatus: { $exists: false } },
          { actionStatus: null },
        ],
      },
      { $set: { actionStatus: 'resolved', resolvedAt: new Date() } }
    );
  } catch (error) {
    console.error(`[OvertimeActions] Failed to resolve alerts (${error instanceof Error ? error.name : 'UnknownError'}).`);
  }
}

export async function snoozeOvertimeAlert(
  sessionId: string | mongoose.Types.ObjectId,
  now = new Date()
): Promise<boolean> {
  const updated = await Session.findOneAndUpdate(
    { _id: sessionId, status: 'active' },
    {
      $set: {
        overtimeSnoozedUntil: new Date(now.getTime() + 15 * 60_000),
        overtimeSnoozeAlertPending: true,
      },
    },
    { new: true }
  );
  return !!updated;
}

export async function remindOvertimeStudent(
  sessionId: string | mongoose.Types.ObjectId
): Promise<boolean> {
  const session = await Session.findOne({ _id: sessionId, status: 'active' })
    .populate<{ student: { _id: mongoose.Types.ObjectId; name: string; isDeleted?: boolean; telegramChatId?: string } }>(
      'student',
      'name isDeleted +telegramChatId'
    );
  if (!session?.student || session.student.isDeleted) {
    throw createError('Active student session not found.', 404);
  }

  const libraryName = await getLibraryNameOrDefault();
  const endedAt = format(session.shiftEndsAt, 'hh:mm a', { timeZone: TZ });
  await NotificationService.enqueue({
    userId: session.student._id,
    type: 'shift_ended',
    vars: { name: session.student.name, shiftEndsAt: endedAt, libraryName },
    message: `Hi ${session.student.name}, your ${session.shiftHours}-hour shift at ${libraryName} ended at ${endedAt}. Please check out now.`,
    forceTelegram: true,
  });
  return !!session.student.telegramChatId;
}
