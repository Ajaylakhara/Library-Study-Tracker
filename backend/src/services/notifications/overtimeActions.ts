import mongoose from 'mongoose';
import { format } from 'date-fns-tz';
import { Notification } from '../../models/Notification';
import { Session } from '../../models/Session';
import { createError } from '../../middleware/errorHandler';
import { getLibraryNameOrDefault } from '../librarySettings';
import { TZ } from '../../utils/time';
import {
  createSmsActionUrl,
  normalizeReminderPhone,
  ReminderChannel,
  validateSmsActionConfiguration,
} from '../feeReminderService';
import { sendMessage } from './providers/telegram';

const REMINDER_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface PreparedOvertimeReminder {
  sessionId: string;
  studentId: string;
  studentName: string;
  phone: string;
  message: string;
  channels: ReminderChannel[];
  preferredChannel: ReminderChannel;
  lastReminder: { sentAt: Date; channel: ReminderChannel } | null;
}

interface OvertimeReminderTarget extends PreparedOvertimeReminder {
  telegramChatId?: string;
  shiftEndsAt: Date;
}

async function findOvertimeReminderTarget(
  sessionId: string | mongoose.Types.ObjectId
): Promise<OvertimeReminderTarget> {
  const session = await Session.findOne({ _id: sessionId, status: 'active' })
    .populate<{
      student: {
        _id: mongoose.Types.ObjectId;
        name: string;
        phone?: string;
        preferredChannel: ReminderChannel;
        isDeleted?: boolean;
        telegramChatId?: string;
      };
    }>('student', 'name phone preferredChannel isDeleted +telegramChatId');
  if (!session?.student || session.student.isDeleted) {
    throw createError('Active student session not found.', 404);
  }

  const [libraryName, lastNotification] = await Promise.all([
    getLibraryNameOrDefault(),
    Notification.findOne({
      sessionId: session._id,
      type: 'shift_ended',
      channel: { $in: ['whatsapp', 'sms', 'telegram'] },
      status: 'sent',
      sentAt: { $gte: new Date(Date.now() - REMINDER_WINDOW_MS) },
    }).sort({ sentAt: -1 }),
  ]);
  const phone = normalizeReminderPhone(session.student.phone);
  const channels: ReminderChannel[] = ['whatsapp', 'sms'];
  if (session.student.telegramChatId) channels.push('telegram');
  const preferredChannel = channels.includes(session.student.preferredChannel)
    ? session.student.preferredChannel
    : 'whatsapp';
  const shiftEndsAt = format(session.shiftEndsAt, 'hh:mm a', { timeZone: TZ });
  const message =
    `Hi ${session.student.name}, your ${session.shiftHours}-hour shift at ${libraryName} ` +
    `ended at ${shiftEndsAt}. Please check out now.`;

  return {
    sessionId: session._id.toString(),
    studentId: session.student._id.toString(),
    studentName: session.student.name,
    phone,
    message,
    channels,
    preferredChannel,
    lastReminder: lastNotification?.sentAt && lastNotification.channel !== 'inapp'
      ? { sentAt: lastNotification.sentAt, channel: lastNotification.channel as ReminderChannel }
      : null,
    telegramChatId: session.student.telegramChatId,
    shiftEndsAt: session.shiftEndsAt,
  };
}

export async function prepareOvertimeReminder(
  sessionId: string | mongoose.Types.ObjectId
): Promise<PreparedOvertimeReminder> {
  const { telegramChatId, shiftEndsAt, ...prepared } = await findOvertimeReminderTarget(sessionId);
  return prepared;
}

export async function sendOvertimeReminder(input: {
  sessionId: string;
  channel: ReminderChannel;
  adminId: mongoose.Types.ObjectId | string;
  confirmRecent?: boolean;
}): Promise<{
  channel: ReminderChannel;
  message: string;
  notificationId?: string;
  url?: string;
  telegramSent?: boolean;
  telegramFailed?: boolean;
  confirmationRequired?: boolean;
  lastReminder?: PreparedOvertimeReminder['lastReminder'];
}> {
  const target = await findOvertimeReminderTarget(input.sessionId);
  if (!target.channels.includes(input.channel)) {
    throw createError(
      input.channel === 'telegram' ? 'Student has not linked Telegram.' : 'Reminder channel is unavailable.',
      400
    );
  }
  if (target.lastReminder && !input.confirmRecent) {
    return {
      channel: input.channel,
      message: target.message,
      confirmationRequired: true,
      lastReminder: target.lastReminder,
    };
  }
  if (input.channel === 'sms') validateSmsActionConfiguration();

  const vars = {
    name: target.studentName,
    shiftEndsAt: format(target.shiftEndsAt, 'hh:mm a', { timeZone: TZ }),
    libraryName: await getLibraryNameOrDefault(),
  };
  if (input.channel === 'telegram') {
    const result = await sendMessage(target.telegramChatId!, target.message);
    const notification = await Notification.findOneAndUpdate(
      {
        sessionId: new mongoose.Types.ObjectId(target.sessionId),
        user: new mongoose.Types.ObjectId(target.studentId),
        type: 'shift_ended',
        channel: 'telegram',
      },
      {
        $set: {
          vars,
          message: target.message,
          status: result.ok ? 'sent' : 'failed',
          sentAt: result.ok ? new Date() : null,
          sentBy: result.ok ? input.adminId : null,
          lastError: result.ok ? null : result.description ?? 'Telegram delivery failed.',
          studentNameSnapshot: target.studentName,
          studentPhoneSnapshot: target.phone,
        },
        $setOnInsert: { attempts: 1 },
      },
      { upsert: true, new: true, setDefaultsOnInsert: true }
    );
    return {
      channel: input.channel,
      message: target.message,
      notificationId: notification._id.toString(),
      telegramSent: result.ok,
      telegramFailed: !result.ok,
    };
  }

  const notification = await Notification.findOneAndUpdate(
    {
      sessionId: new mongoose.Types.ObjectId(target.sessionId),
      user: new mongoose.Types.ObjectId(target.studentId),
      type: 'shift_ended',
      channel: input.channel,
    },
    {
      $set: {
        vars,
        message: target.message,
        status: 'manual_pending',
        sentAt: null,
        sentBy: null,
        lastError: null,
        studentNameSnapshot: target.studentName,
        studentPhoneSnapshot: target.phone,
      },
      $setOnInsert: { attempts: 0 },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
  return {
    channel: input.channel,
    message: target.message,
    notificationId: notification._id.toString(),
    url: input.channel === 'whatsapp'
      ? `https://wa.me/${target.phone.replace(/\D/g, '')}?text=${encodeURIComponent(target.message)}`
      : createSmsActionUrl(notification._id.toString()),
  };
}

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
