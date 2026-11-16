import { Notification } from '../models/Notification';
import { Session } from '../models/Session';
import { Seat } from '../models/Seat';
import { templates } from '../services/notifications/templates';
import { telegramProvider } from '../services/notifications/providers/telegramProvider';
import { TelegramInlineKeyboard } from '../services/notifications/providers/telegram';
import {
  buildOvertimeAlertText,
  buildOvertimeKeyboard,
} from '../services/notifications/adminBotHandlers';
import { formatIST } from '../utils/time';
import { logEvent } from '../utils/logger';

/** Quick attempts before a notification is shown as failed. */
export const MAX_ATTEMPTS = 3;
/** Hard cap including the later automatic retries of failed Telegram notifications. */
export const MAX_TOTAL_ATTEMPTS = 8;
/** Failed Telegram notifications are retried automatically for this long. */
export const RETRY_WINDOW_MS = 24 * 60 * 60_000;
/** Wait after attempt N (1-based) before attempt N+1. */
const BACKOFF_MINUTES = [1, 2, 5, 10, 15, 30, 60];
const SESSION_BOUND_TYPES = ['shift_reminder', 'shift_ended', 'overtime_admin'];

export function backoffMs(attemptsMade: number): number {
  const minutes = BACKOFF_MINUTES[Math.min(Math.max(attemptsMade, 1), BACKOFF_MINUTES.length) - 1];
  return minutes * 60_000;
}

export interface ProcessQueuedNotificationOptions {
  notificationIds?: readonly string[];
  maxDurationMs?: number;
}

export interface NotificationWorkerResult {
  processed: number;
  sent: number;
  errors: number;
}

export async function processQueuedNotifications(
  sendTelegramMessage: (
    chatId: string,
    text: string,
    keyboard?: TelegramInlineKeyboard,
    parseMode?: 'HTML'
  ) => Promise<void> = telegramProvider.sendMessage.bind(telegramProvider),
  options: ProcessQueuedNotificationOptions = {}
): Promise<NotificationWorkerResult> {
  const startedAt = Date.now();
  const nowDate = new Date();
  const eligible = {
    $or: [
      // Normal queue.
      { status: 'queued', attempts: { $lt: MAX_ATTEMPTS } },
      // Telegram messages that failed in the last 24 hours are retried with backoff.
      {
        status: 'failed',
        channel: 'telegram',
        permanentFailure: { $ne: true },
        attempts: { $lt: MAX_TOTAL_ATTEMPTS },
        updatedAt: { $gte: new Date(nowDate.getTime() - RETRY_WINDOW_MS) },
      },
    ],
  };
  const query: Record<string, unknown> = { $and: [eligible] };
  if (options.notificationIds !== undefined) {
    // Explicit ids (tests, manual runs) bypass the backoff wait.
    query._id = { $in: options.notificationIds };
  } else {
    (query.$and as unknown[]).push({
      $or: [{ nextAttemptAt: null }, { nextAttemptAt: { $lte: nowDate } }],
    });
  }

  const pending = await Notification.find(query)
    .sort({ createdAt: 1 })
    .limit(50)
    .populate({ path: 'user', select: 'phone name isDeleted +telegramChatId' });

  const result: NotificationWorkerResult = { processed: 0, sent: 0, errors: 0 };
  for (const notif of pending) {
    if (options.maxDurationMs !== undefined && Date.now() - startedAt >= options.maxDurationMs) break;
    result.processed++;
    const user = notif.user as unknown as {
      phone: string;
      name: string;
      telegramChatId?: string;
      isDeleted?: boolean;
    } | null;

    if (!user || user.isDeleted) {
      // Cancel/delete queued notifications for missing or deleted users
      await Notification.findByIdAndDelete(notif._id);
      continue;
    }

    const template = templates[notif.type];
    const vars =
      notif.vars instanceof Map
        ? Object.fromEntries(notif.vars)
        : (notif.vars as Record<string, string | number>);
    const baseMessage = notif.message || template.buildMessage(vars);

    // A failed notification being retried must still refer to a live session.
    if (
      notif.status === 'failed' &&
      notif.sessionId &&
      SESSION_BOUND_TYPES.includes(notif.type)
    ) {
      const live = await Session.exists({ _id: notif.sessionId, status: 'active' });
      if (!live) {
        await Notification.findByIdAndUpdate(notif._id, {
          permanentFailure: true,
          nextAttemptAt: null,
          lastError: 'Not retried: the study session has already ended.',
        });
        continue;
      }
    }

    await Notification.findByIdAndUpdate(notif._id, {
      $inc: { attempts: 1 },
      $set: { lastAttemptAt: new Date() },
    });

    try {
      if (notif.channel === 'inapp') {
        await Notification.findByIdAndUpdate(notif._id, {
          status: 'sent',
          sentAt: new Date(),
          message: baseMessage,
          lastError: notif.warning ? notif.lastError : null,
          nextAttemptAt: null,
        });
        result.sent++;
        continue;
      }

      if (notif.channel !== 'telegram') {
        throw new Error(`Unsupported queued notification channel: ${notif.channel}`);
      }
      if (!user.telegramChatId) throw new Error('Telegram account is no longer linked.');

      let messageToSend = baseMessage;
      let keyboard: TelegramInlineKeyboard | undefined;
      let parseMode: 'HTML' | undefined;

      // For overtime_admin sent via Telegram, load student name/phone from session & build rich message with buttons
      if (notif.type === 'overtime_admin' && notif.sessionId) {
        const session = await Session.findById(notif.sessionId)
          .populate<{ student: { name: string; phone?: string; isDeleted?: boolean } }>(
            'student',
            'name phone isDeleted'
          )
          .populate<{ seat: { number: number } }>('seat', 'number');

        const studentName =
          session?.student?.name ||
          notif.studentNameSnapshot ||
          (vars.studentName ? String(vars.studentName) : 'Unknown');
        const studentPhone =
          session?.student?.phone ||
          notif.studentPhoneSnapshot ||
          (vars.studentPhone ? String(vars.studentPhone) : undefined);
        const seatNumber = session?.seat?.number || vars.seatNumber || '?';
        const shiftHours = session?.shiftHours || (vars.shiftHours ? Number(vars.shiftHours) : 4);
        const shiftLabel = `${shiftHours}-hour`;
        const shiftEndsAtIST = session
          ? formatIST(session.shiftEndsAt, 'hh:mm a')
          : String(vars.shiftEndsAt || '');
        const minutesOver = session
          ? Math.max(0, Math.floor((Date.now() - session.shiftEndsAt.getTime()) / 60000))
          : Number(vars.minutesPastEnd) || 15;

        const [activeSeatsCount, activeSessionsCount] = await Promise.all([
          Seat.countDocuments({ isActive: true }),
          Session.countDocuments({ status: 'active' }),
        ]);
        const capacity = activeSeatsCount || 70;

        messageToSend = buildOvertimeAlertText({
          studentName,
          seatNumber,
          shiftLabel,
          shiftEndsAtIST,
          minutesOver,
          studyingNow: activeSessionsCount,
          capacity,
        });

        keyboard = buildOvertimeKeyboard({
          sessionId: notif.sessionId.toString(),
          studentPhone,
          studentName,
          shiftEndsAtIST,
        });

        parseMode = 'HTML';
      }

      await sendTelegramMessage(user.telegramChatId, messageToSend, keyboard, parseMode);

      await Notification.findByIdAndUpdate(notif._id, {
        status: 'sent',
        sentAt: new Date(),
        message: messageToSend,
        lastError: null,
        nextAttemptAt: null,
        permanentFailure: false,
      });
      result.sent++;
    } catch (err: unknown) {
      result.errors++;
      const error = err instanceof Error ? err : new Error(String(err));
      const errorCode = (err as { errorCode?: number })?.errorCode;
      const retryAfter = (err as { retryAfter?: number })?.retryAfter;

      // Requirement 9: Treat 403 (bot blocked) as a permanent failure immediately
      const isBlocked =
        errorCode === 403 ||
        error.message.includes('403') ||
        error.message.includes('bot blocked by user');

      const attempts = Math.max((notif.attempts ?? 0) + 1, isBlocked ? MAX_ATTEMPTS : 0);
      const errorText = error.message || 'Unknown error';
      const logFields = {
        notificationId: String(notif._id),
        notificationType: notif.type,
        channel: notif.channel,
        sessionId: notif.sessionId ? String(notif.sessionId) : undefined,
        attempts,
      };

      if (isBlocked) {
        // Telegram refused for good (bot blocked): do not keep retrying automatically.
        await Notification.findByIdAndUpdate(notif._id, {
          status: 'failed',
          attempts,
          lastError: errorText,
          permanentFailure: true,
          nextAttemptAt: null,
        });
        logEvent('error', 'notification_delivery_failed', { ...logFields, permanent: true }, error);
        continue;
      }

      const exhausted = attempts >= MAX_TOTAL_ATTEMPTS;
      // Respect Telegram's retry_after (429) without blocking the cron tick.
      const waitMs = Math.max(backoffMs(attempts), errorCode === 429 && retryAfter ? retryAfter * 1000 : 0);
      await Notification.findByIdAndUpdate(notif._id, {
        status: attempts >= MAX_ATTEMPTS ? 'failed' : 'queued',
        lastError: errorText,
        nextAttemptAt: exhausted ? null : new Date(Date.now() + waitMs),
      });
      logEvent(
        'error',
        'notification_delivery_failed',
        { ...logFields, willRetry: !exhausted, retryInMs: exhausted ? null : waitMs },
        error
      );
    }
  }
  logEvent('info', 'notification_worker_run_complete', {
    processed: result.processed,
    sent: result.sent,
    errors: result.errors,
    durationMs: Date.now() - startedAt,
  });
  return result;
}
