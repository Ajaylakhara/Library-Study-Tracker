import { createHmac, timingSafeEqual } from 'crypto';
import mongoose from 'mongoose';
import { Fee, IFee } from '../models/Fee';
import { Notification, NotificationChannel, INotification } from '../models/Notification';
import { IUser, User } from '../models/User';
import { config } from '../config';
import { createError } from '../middleware/errorHandler';
import { getLibraryNameOrDefault } from './librarySettings';
import { templates } from './notifications/templates';
import { sendMessage } from './notifications/providers/telegram';

export type ReminderChannel = 'whatsapp' | 'sms' | 'telegram';
const REMINDER_WINDOW_MS = 24 * 60 * 60 * 1000;

export interface ReminderTarget {
  feeId?: string;
  userId?: string;
}

export interface PreparedFeeReminder {
  feeId: string;
  studentId: string;
  studentName: string;
  phone: string;
  month: string;
  amount: number;
  totalDue: number;
  message: string;
  channels: ReminderChannel[];
  preferredChannel: ReminderChannel;
  lastReminder: { sentAt: Date; channel: ReminderChannel } | null;
}

export function normalizeReminderPhone(
  phone: string | null | undefined,
  countryCode = config.defaultCountryCode
): string {
  const defaultCode = countryCode.trim();
  if (!/^\+[1-9]\d{0,2}$/.test(defaultCode)) {
    throw createError('DEFAULT_COUNTRY_CODE must be an international calling code such as +91.', 500);
  }
  if (!phone) throw createError('Student phone number is missing or invalid.', 400);

  const input = phone.trim();
  const digits = input.replace(/\D/g, '');
  const countryDigits = defaultCode.slice(1);
  let normalized: string;
  if (input.startsWith('+')) {
    normalized = `+${digits}`;
  } else if (digits.length === 10) {
    if (defaultCode === '+91' && !/^[6-9]\d{9}$/.test(digits)) {
      throw createError('Student phone number is missing or invalid.', 400);
    }
    normalized = `${defaultCode}${digits}`;
  } else if (digits.length > 10 && digits.startsWith(countryDigits)) {
    normalized = `+${digits}`;
  } else if (digits.startsWith('00') && digits.length > 10) {
    normalized = `+${digits.slice(2)}`;
  } else {
    throw createError('Student phone number is missing or invalid.', 400);
  }

  if (!/^\+[1-9]\d{7,14}$/.test(normalized)) {
    throw createError('Student phone number is missing or invalid.', 400);
  }
  return normalized;
}

function isReminderChannel(value: string): value is ReminderChannel {
  return value === 'whatsapp' || value === 'sms' || value === 'telegram';
}

async function findReminderFee(target: ReminderTarget): Promise<{
  fee: IFee;
  student: IUser;
}> {
  if ((!target.feeId && !target.userId) || (target.feeId && target.userId)) {
    throw createError('Provide a fee or student to prepare a reminder.', 400);
  }

  const feeQuery = target.feeId
    ? Fee.findOne({ _id: target.feeId, status: 'unpaid' })
    : Fee.findOne({ student: target.userId, status: 'unpaid' }).sort({ month: 1, createdAt: 1 });
  const fee = await feeQuery;
  if (!fee) throw createError('No unpaid fee was found for this reminder.', 404);

  const student = await User.findOne({
    _id: fee.student,
    role: 'student',
    isDeleted: false,
  }).select('+telegramChatId');
  if (!student) throw createError('Student not found.', 404);
  return { fee, student };
}

export async function prepareReminder(
  target: ReminderTarget,
  requestedChannel?: ReminderChannel
): Promise<PreparedFeeReminder> {
  const { fee, student } = await findReminderFee(target);
  const phone = normalizeReminderPhone(student.phone);
  const channels: ReminderChannel[] = ['whatsapp', 'sms'];
  if (student.telegramChatId) channels.push('telegram');

  if (requestedChannel && !channels.includes(requestedChannel)) {
    throw createError(
      requestedChannel === 'telegram'
        ? 'Student has not linked Telegram.'
        : 'That reminder channel is not available.',
      400
    );
  }

  const [unpaid, libraryName] = await Promise.all([
    Fee.aggregate<{ total: number }>([
      { $match: { student: student._id, status: 'unpaid' } },
      { $group: { _id: null, total: { $sum: '$amount' } } },
    ]),
    getLibraryNameOrDefault(),
  ]);
  const totalDue = unpaid[0]?.total ?? fee.amount;
  const message = templates.fee_unpaid.buildMessage({
    name: student.name,
    amount: fee.amount,
    month: fee.month,
    totalDue,
    libraryName,
  });
  const preferredChannel = isReminderChannel(student.preferredChannel) &&
      channels.includes(student.preferredChannel)
    ? student.preferredChannel
    : 'whatsapp';
  const lastReminderAt = fee.lastReminderAt;
  const lastReminder = lastReminderAt &&
      Date.now() - lastReminderAt.getTime() < REMINDER_WINDOW_MS &&
      fee.lastReminderChannel
    ? { sentAt: lastReminderAt, channel: fee.lastReminderChannel }
    : null;

  return {
    feeId: fee._id.toString(),
    studentId: student._id.toString(),
    studentName: student.name,
    phone,
    month: fee.month,
    amount: fee.amount,
    totalDue,
    message,
    channels,
    preferredChannel,
    lastReminder,
  };
}

function smsTokenSecret(): string {
  if (config.smsActionTokenSecret.length < 32) {
    throw createError('SMS_ACTION_TOKEN_SECRET must be configured with at least 32 characters.', 500);
  }
  return config.smsActionTokenSecret;
}

function signSmsAction(notificationId: string, expiresAt: number): string {
  const payload = `${notificationId}.${expiresAt}`;
  const signature = createHmac('sha256', smsTokenSecret()).update(payload).digest('base64url');
  return `${Buffer.from(payload).toString('base64url')}.${signature}`;
}

function verifySmsAction(token: string): { notificationId: string; expiresAt: number } {
  const [encodedPayload, signature, extra] = token.split('.');
  if (!encodedPayload || !signature || extra) throw createError('SMS link is invalid or expired.', 400);
  let payload: string;
  try {
    payload = Buffer.from(encodedPayload, 'base64url').toString('utf8');
  } catch {
    throw createError('SMS link is invalid or expired.', 400);
  }
  const [notificationId, expiration, payloadExtra] = payload.split('.');
  const expiresAt = Number(expiration);
  const expected = createHmac('sha256', smsTokenSecret()).update(payload).digest();
  let received: Buffer;
  try {
    received = Buffer.from(signature, 'base64url');
  } catch {
    throw createError('SMS link is invalid or expired.', 400);
  }
  if (
    payloadExtra ||
    !mongoose.isValidObjectId(notificationId) ||
    !Number.isSafeInteger(expiresAt) ||
    expiresAt <= Date.now() ||
    received.length !== expected.length ||
    !timingSafeEqual(received, expected)
  ) {
    throw createError('SMS link is invalid or expired.', 400);
  }
  return { notificationId, expiresAt };
}

function notificationVars(prepared: PreparedFeeReminder, libraryName: string) {
  return {
    name: prepared.studentName,
    month: prepared.month,
    amount: prepared.amount,
    totalDue: prepared.totalDue,
    libraryName,
  };
}

export async function sendReminder(input: {
  feeId: string;
  adminId: mongoose.Types.ObjectId | string;
  channel: ReminderChannel;
  message?: string;
  confirmRecent?: boolean;
}): Promise<{
  notificationId?: string;
  channel: ReminderChannel;
  message: string;
  url?: string;
  smsUri?: string;
  confirmationRequired?: boolean;
  lastReminder?: PreparedFeeReminder['lastReminder'];
  telegramSent?: boolean;
}> {
  const prepared = await prepareReminder({ feeId: input.feeId }, input.channel);
  const message = input.message?.trim() || prepared.message;
  if (message.length > 2000) throw createError('Reminder message must be 2,000 characters or fewer.', 400);
  if (prepared.lastReminder && !input.confirmRecent) {
    return {
      channel: input.channel,
      message,
      confirmationRequired: true,
      lastReminder: prepared.lastReminder,
    };
  }

  const libraryName = await getLibraryNameOrDefault();
  const vars = notificationVars(prepared, libraryName);
  if (input.channel === 'sms') smsTokenSecret();
  if (input.channel === 'telegram') {
    const user = await User.findById(prepared.studentId).select('+telegramChatId');
    if (!user?.telegramChatId) throw createError('Student has not linked Telegram.', 400);
    const result = await sendMessage(user.telegramChatId, message);
    const notification = await Notification.create({
      user: user._id,
      type: 'fee_unpaid',
      vars,
      message,
      channel: 'telegram',
      status: result.ok ? 'sent' : 'failed',
      sentAt: result.ok ? new Date() : null,
      sentBy: result.ok ? input.adminId : null,
      providerMessageId: result.messageId ? String(result.messageId) : null,
      lastError: result.ok ? null : 'Telegram delivery failed.',
      feeId: prepared.feeId,
      studentNameSnapshot: prepared.studentName,
      studentPhoneSnapshot: prepared.phone,
      attempts: 1,
    });
    if (!result.ok) {
      throw createError('Telegram could not deliver this reminder. Check the student link and try again.', 502);
    }
    await Fee.updateOne(
      { _id: prepared.feeId },
      { $set: { lastReminderAt: notification.sentAt, lastReminderChannel: 'telegram' }, $inc: { reminderCount: 1 } }
    );
    return { notificationId: notification._id.toString(), channel: input.channel, message, telegramSent: true };
  }

  const notification = await Notification.create({
    user: prepared.studentId,
    type: 'fee_unpaid',
    vars,
    message,
    channel: input.channel as NotificationChannel,
    status: 'manual_pending',
    feeId: prepared.feeId,
    studentNameSnapshot: prepared.studentName,
    studentPhoneSnapshot: prepared.phone,
    attempts: 0,
  });

  if (input.channel === 'whatsapp') {
    const digits = prepared.phone.replace(/\D/g, '');
    return {
      notificationId: notification._id.toString(),
      channel: input.channel,
      message,
      url: `https://wa.me/${digits}?text=${encodeURIComponent(message)}`,
    };
  }

  const expiresAt = Date.now() + REMINDER_WINDOW_MS;
  const token = signSmsAction(notification._id.toString(), expiresAt);
  const clientUrl = config.clientUrl.replace(/\/+$/, '');
  const digits = prepared.phone.replace(/\D/g, '');
  return {
    notificationId: notification._id.toString(),
    channel: input.channel,
    message,
    url: `${clientUrl}/admin/send/${token}`,
    smsUri: `sms:${prepared.phone}?body=${encodeURIComponent(message)}`,
  };
}

export async function getSmsAction(token: string): Promise<{
  notificationId: string;
  phone: string;
  message: string;
  smsUri: string;
}> {
  const { notificationId } = verifySmsAction(token);
  const notification = await Notification.findOne({
    _id: notificationId,
    type: 'fee_unpaid',
    channel: 'sms',
    status: 'manual_pending',
  });
  if (!notification) throw createError('SMS link is no longer available.', 404);
  const phone = normalizeReminderPhone(notification.studentPhoneSnapshot);
  return {
    notificationId,
    phone,
    message: notification.message,
    smsUri: `sms:${phone}?body=${encodeURIComponent(notification.message)}`,
  };
}

export async function markSent(
  notificationId: string,
  adminId: mongoose.Types.ObjectId | string
): Promise<{ notification: INotification; alreadySent: boolean }> {
  if (!mongoose.isValidObjectId(notificationId)) throw createError('Notification not found.', 404);
  const notification = await Notification.findOneAndUpdate(
    {
      _id: notificationId,
      type: 'fee_unpaid',
      channel: { $in: ['whatsapp', 'sms'] },
      status: 'manual_pending',
    },
    {
      $set: {
        status: 'sent',
        sentAt: new Date(),
        sentBy: adminId,
        lastError: null,
      },
    },
    { new: true }
  );
  if (notification) {
    if (notification.feeId) {
      await Fee.updateOne(
        { _id: notification.feeId },
        {
          $set: {
            lastReminderAt: notification.sentAt,
            lastReminderChannel: notification.channel,
          },
          $inc: { reminderCount: 1 },
        }
      );
    }
    return { notification, alreadySent: false };
  }

  const existing = await Notification.findOne({
    _id: notificationId,
    type: 'fee_unpaid',
    channel: { $in: ['whatsapp', 'sms'] },
    status: 'sent',
  });
  if (!existing) throw createError('Notification not found or is no longer pending.', 404);
  return { notification: existing, alreadySent: true };
}
