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
import { format } from 'date-fns-tz';
import { TZ } from '../utils/time';

const MAX_ATTEMPTS = 3;

export interface ProcessQueuedNotificationOptions {
  notificationIds?: readonly string[];
}

export async function processQueuedNotifications(
  sendTelegramMessage: (
    chatId: string,
    text: string,
    keyboard?: TelegramInlineKeyboard,
    parseMode?: 'HTML'
  ) => Promise<void> = telegramProvider.sendMessage.bind(telegramProvider),
  options: ProcessQueuedNotificationOptions = {}
): Promise<void> {
  const query: Record<string, unknown> = {
    status: 'queued',
    attempts: { $lt: MAX_ATTEMPTS },
  };
  if (options.notificationIds !== undefined) {
    query._id = { $in: options.notificationIds };
  }

  const pending = await Notification.find(query)
    .limit(50)
    .populate({ path: 'user', select: 'phone name isDeleted +telegramChatId' });

  for (const notif of pending) {
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

    await Notification.findByIdAndUpdate(notif._id, { $inc: { attempts: 1 } });

    try {
      if (notif.channel === 'inapp') {
        await Notification.findByIdAndUpdate(notif._id, {
          status: 'sent',
          sentAt: new Date(),
          message: baseMessage,
          lastError: null,
        });
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
          ? format(session.shiftEndsAt, 'hh:mm a', { timeZone: TZ })
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
      });
    } catch (err: unknown) {
      const error = err instanceof Error ? err : new Error(String(err));
      const errorCode = (err as { errorCode?: number })?.errorCode;
      const retryAfter = (err as { retryAfter?: number })?.retryAfter;

      // Requirement 9: Treat 403 (bot blocked) as a permanent failure immediately
      const isBlocked =
        errorCode === 403 ||
        error.message.includes('403') ||
        error.message.includes('bot blocked by user');

      if (isBlocked) {
        await Notification.findByIdAndUpdate(notif._id, {
          status: 'failed',
          attempts: MAX_ATTEMPTS,
          lastError: 'bot blocked by user',
        });
        continue;
      }

      // Requirement 9: Respect retry_after on 429
      if (errorCode === 429 && retryAfter) {
        await new Promise((res) => setTimeout(res, Math.min(retryAfter, 5) * 1000));
      }

      const attempts = (notif.attempts ?? 0) + 1;
      const isFinal = attempts >= MAX_ATTEMPTS;

      await Notification.findByIdAndUpdate(notif._id, {
        status: isFinal ? 'failed' : 'queued',
        lastError: error.message ?? 'Unknown error',
      });

      if (isFinal) {
        console.error(
          `[NotificationWorker] Notification ${notif._id} (${notif.type}) permanently failed after ${MAX_ATTEMPTS} attempts.`
        );
      }
    }
  }
}
