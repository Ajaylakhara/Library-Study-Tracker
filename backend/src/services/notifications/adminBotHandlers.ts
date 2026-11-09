/**
 * Admin bot command handlers, callback handlers, and shared business operations.
 *
 * Implements:
 *  - requireLinkedAdmin: single authorization helper checking private chat, admin role,
 *    approved status, not blocked, not soft-deleted, with linked telegramChatId.
 *  - handleHelp: lists admin bot commands.
 *  - handleLive: active sessions grouped by shift, chunked under 4096 characters,
 *    with capacity from active seat count.
 *  - handleOvertime: active sessions past shiftEndsAt with minutes over.
 *  - escapeHtml: escapes names and text for HTML parse mode.
 *  - buildOvertimeAlertText & buildOvertimeKeyboard: rich overtime message & buttons.
 *  - recordManualNotificationSent: shared function for HTTP controller and bot "Mark as sent".
 *  - performForceCheckout: atomic force-checkout shared by adminController and bot.
 *  - handleBotCallbackQuery: callback handler with authorization and confirm/cancel flows.
 */

import mongoose from 'mongoose';
import { format } from 'date-fns-tz';
import { User, IUser } from '../../models/User';
import { Seat } from '../../models/Seat';
import { Session, ISession } from '../../models/Session';
import { Notification, INotification } from '../../models/Notification';
import { resolveOvertimeAlerts } from './overtimeActions';
import { diffMinutes, formatDuration, TZ } from '../../utils/time';
import { buildWhatsAppUrl } from '../../utils/phone';
import {
  sendMessageHtml,
  sendReplyKeyboard,
  answerCallbackQuery,
  editMessageText,
  TelegramSendResult,
  TelegramInlineKeyboard,
  TelegramInlineButton,
} from './providers/telegram';

export const ADMIN_KEYBOARD_ROWS = [['📊 Live', '⏰ Overtime']];
export const ADMIN_REFUSAL_MESSAGE = '⛔ This bot is only accessible to authorized administrators.';

/**
 * Escapes characters for Telegram HTML parse mode.
 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

/**
 * Splits text into chunks under maxLen characters (default 4000 to stay safely below 4096).
 */
export function splitIntoChunks(text: string, maxLen = 4000): string[] {
  if (text.length <= maxLen) return [text];
  const lines = text.split('\n');
  const chunks: string[] = [];
  let current = '';

  for (const line of lines) {
    if ((current + '\n' + line).length > maxLen) {
      if (current) chunks.push(current);
      current = line;
    } else {
      current = current ? current + '\n' + line : line;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

/**
 * Verifies that the chat is private and belongs to an approved, non-deleted,
 * non-blocked admin with their telegram account linked.
 *
 * Returns the admin user document if valid, or null if unauthorized.
 */
export async function requireLinkedAdmin(
  chatId: string,
  chatType: string
): Promise<IUser | null> {
  if (chatType !== 'private') {
    return null;
  }

  const admin = await User.findOne({
    telegramChatId: chatId,
    role: 'admin',
    status: 'approved',
    isDeleted: false,
  }).select('+telegramChatId');

  return admin;
}

/**
 * /help command handler
 */
export async function handleHelp(
  chatId: string,
  sendReply: typeof sendReplyKeyboard = sendReplyKeyboard
): Promise<void> {
  const text =
    '📚 <b>Library Admin Bot Help</b>\n\n' +
    'Available commands:\n' +
    '• /live (or <b>📊 Live</b>) — View students currently studying grouped by shift\n' +
    '• /overtime (or <b>⏰ Overtime</b>) — View students past their shift end\n' +
    '• /help — Show this help message\n' +
    '• /myid — Show your Telegram chat ID\n\n' +
    '<i>Tap the buttons below for quick access.</i>';

  await sendReply(chatId, text, ADMIN_KEYBOARD_ROWS, 'HTML');
}

/**
 * /live command handler:
 * Shows students currently studying, capacity from active seats,
 * grouped by shift with time left in Asia/Kolkata timezone,
 * split into chunks under 4096 chars.
 */
export async function handleLive(
  chatId: string,
  sendReply: typeof sendReplyKeyboard = sendReplyKeyboard,
  sendMsg: typeof sendMessageHtml = sendMessageHtml
): Promise<void> {
  const now = new Date();

  const [totalSeatsCount, activeSessions] = await Promise.all([
    Seat.countDocuments({ isActive: true }),
    Session.find({ status: 'active' })
      .populate<{ student: { name: string } }>('student', 'name')
      .populate<{ seat: { number: number } }>('seat', 'number')
      .sort({ shiftEndsAt: 1 }),
  ]);

  const capacity = totalSeatsCount || 70;
  const count = activeSessions.length;

  if (count === 0) {
    const text = `📊 <b>Live Study Status</b> (0 / ${capacity})\n\nNo students are currently studying.`;
    await sendReply(chatId, text, ADMIN_KEYBOARD_ROWS, 'HTML');
    return;
  }

  // Group by shiftHours
  const shiftsMap = new Map<number, Array<(typeof activeSessions)[0]>>();
  for (const session of activeSessions) {
    const hours = session.shiftHours || 4;
    const existing = shiftsMap.get(hours) || [];
    existing.push(session);
    shiftsMap.set(hours, existing);
  }

  // Sort shifts numerically (e.g. 4h, 12h, 24h)
  const sortedShifts = Array.from(shiftsMap.keys()).sort((a, b) => a - b);

  let fullMessage = `📊 <b>Live Study Status</b> (${count} / ${capacity})\n`;

  for (const shiftHours of sortedShifts) {
    const sessions = shiftsMap.get(shiftHours) || [];
    fullMessage += `\n⏱ <b>${shiftHours}h Shift</b> (${sessions.length})\n`;

    for (const s of sessions) {
      const studentName = escapeHtml(s.student?.name || 'Unknown');
      const seatNumber = s.seat?.number ?? '?';
      const diffMs = s.shiftEndsAt.getTime() - now.getTime();
      const diffMin = Math.floor(diffMs / 60000);

      let timeStatus: string;
      if (diffMin < 0) {
        timeStatus = `⚠️ <b>${Math.abs(diffMin)}m over</b>`;
      } else {
        timeStatus = `${formatDuration(diffMin)} left`;
      }

      fullMessage += `• ${studentName} · Seat ${seatNumber} · ${timeStatus}\n`;
    }
  }

  const chunks = splitIntoChunks(fullMessage);
  for (let i = 0; i < chunks.length; i++) {
    const isLast = i === chunks.length - 1;
    if (isLast) {
      await sendReply(chatId, chunks[i], ADMIN_KEYBOARD_ROWS, 'HTML');
    } else {
      await sendMsg(chatId, chunks[i]);
    }
  }
}

/**
 * /overtime command handler:
 * Shows active sessions past shiftEndsAt with minutes over.
 */
export async function handleOvertime(
  chatId: string,
  sendReply: typeof sendReplyKeyboard = sendReplyKeyboard
): Promise<void> {
  const now = new Date();

  const overtimeSessions = await Session.find({
    status: 'active',
    shiftEndsAt: { $lt: now },
  })
    .populate<{ student: { name: string } }>('student', 'name')
    .populate<{ seat: { number: number } }>('seat', 'number')
    .sort({ shiftEndsAt: 1 });

  if (overtimeSessions.length === 0) {
    const text = '⏰ <b>Overtime Status</b>\n\n✅ No students are in overtime right now.';
    await sendReply(chatId, text, ADMIN_KEYBOARD_ROWS, 'HTML');
    return;
  }

  let text = `⏰ <b>Students in Overtime</b> (${overtimeSessions.length})\n\n`;

  for (const s of overtimeSessions) {
    const studentName = escapeHtml(s.student?.name || 'Unknown');
    const seatNumber = s.seat?.number ?? '?';
    const minutesOver = Math.floor((now.getTime() - s.shiftEndsAt.getTime()) / 60000);
    const shiftEndsAtIST = format(s.shiftEndsAt, 'hh:mm a', { timeZone: TZ });

    text += `• <b>${studentName}</b> · Seat ${seatNumber}\n`;
    text += `  ${s.shiftHours}h shift · ended ${shiftEndsAtIST} · ⚠️ <b>${minutesOver}m over</b>\n`;
  }

  await sendReply(chatId, text, ADMIN_KEYBOARD_ROWS, 'HTML');
}

/**
 * Builds the overtime alert text in HTML format.
 */
export function buildOvertimeAlertText(opts: {
  studentName: string;
  seatNumber: number | string;
  shiftLabel: string;
  shiftEndsAtIST: string;
  minutesOver: number;
  studyingNow: number;
  capacity: number;
}): string {
  const {
    studentName,
    seatNumber,
    shiftLabel,
    shiftEndsAtIST,
    minutesOver,
    studyingNow,
    capacity,
  } = opts;

  return (
    `⏰ <b>Overtime Alert</b>\n\n` +
    `<b>${escapeHtml(studentName)}</b> · Seat ${seatNumber} · ${shiftLabel} shift\n` +
    `Shift ended ${shiftEndsAtIST} · ⚠️ <b>${minutesOver} min over</b>\n` +
    `Studying now: ${studyingNow} / ${capacity}`
  );
}

/**
 * Builds inline buttons for an overtime alert:
 * - [📲 WhatsApp <firstName>] (if normalized Indian phone is valid)
 * - [✅ Mark as sent] (callback_data: ot:sent:<sessionId>)
 * - [🚪 Force checkout] (callback_data: ot:force:<sessionId>)
 */
export function buildOvertimeKeyboard(opts: {
  sessionId: string;
  studentPhone: string | null | undefined;
  studentName: string;
  shiftEndsAtIST: string;
}): TelegramInlineKeyboard {
  const { sessionId, studentPhone, studentName, shiftEndsAtIST } = opts;
  const firstName = studentName.trim().split(/\s+/)[0] || studentName;
  const keyboard: TelegramInlineButton[][] = [];

  const waMessage = `Hi ${firstName}, your study shift ended at ${shiftEndsAtIST} and you are in overtime. Please check out or contact the librarian.`;
  const waUrl = buildWhatsAppUrl(studentPhone, waMessage);

  if (waUrl) {
    keyboard.push([{ text: `📲 WhatsApp ${firstName}`, url: waUrl }]);
  }

  keyboard.push([
    { text: '✅ Mark as sent', callback_data: `ot:sent:${sessionId}` },
    { text: '🚪 Force checkout', callback_data: `ot:force:${sessionId}` },
  ]);

  return keyboard;
}

// ─── Shared Business Logic: "Mark as sent" (Requirement 1) ───────────────────

export interface RecordSentResult {
  success: boolean;
  notFound?: boolean;
  alreadyMarked?: boolean;
  markedBy?: string;
  markedAt?: string;
  notification?: INotification;
}

/**
 * Shared logic for recording a manual notification as sent.
 * Used by both HTTP controller (markManualNotificationSent) and Telegram bot callback.
 * Writes to the same fields the Alerts page reads: status='sent', sentAt, contactedAt, contactedBy, actionStatus='contacted'.
 */
export async function recordManualNotificationSent(opts: {
  notificationId?: string;
  sessionId?: string;
  admin: IUser;
}): Promise<RecordSentResult> {
  const { notificationId, sessionId, admin } = opts;
  const now = new Date();

  let studentNotif: INotification | null = null;

  if (notificationId) {
    studentNotif = await Notification.findById(notificationId);
  } else if (sessionId) {
    studentNotif = await Notification.findOne({
      sessionId: new mongoose.Types.ObjectId(sessionId),
      type: 'overtime_admin',
      channel: { $in: ['whatsapp', 'sms'] },
    });
  }

  if (!studentNotif) {
    return { success: false, notFound: true };
  }

  // If already sent or marked contacted
  if (studentNotif.status === 'sent' || studentNotif.actionStatus === 'contacted') {
    const populated = await Notification.findById(studentNotif._id).populate<{ contactedBy: { name: string } }>(
      'contactedBy',
      'name'
    );
    const adminName = populated?.contactedBy?.name || 'another admin';
    const timeStr = format(populated?.sentAt || populated?.contactedAt || now, 'hh:mm a', { timeZone: TZ });
    return {
      success: false,
      alreadyMarked: true,
      markedBy: adminName,
      markedAt: timeStr,
      notification: studentNotif,
    };
  }

  // Atomic update
  const updated = await Notification.findOneAndUpdate(
    {
      _id: studentNotif._id,
      status: 'manual_pending',
    },
    {
      $set: {
        status: 'sent',
        sentAt: now,
        contactedAt: now,
        contactedBy: admin._id,
        contactMethod: studentNotif.channel === 'sms' ? 'sms' : 'whatsapp',
        actionStatus: 'contacted',
        lastError: null,
      },
    },
    { new: true }
  );

  if (!updated) {
    const populated = await Notification.findById(studentNotif._id).populate<{ contactedBy: { name: string } }>(
      'contactedBy',
      'name'
    );
    const adminName = populated?.contactedBy?.name || 'another admin';
    const timeStr = format(populated?.sentAt || populated?.contactedAt || now, 'hh:mm a', { timeZone: TZ });
    return {
      success: false,
      alreadyMarked: true,
      markedBy: adminName,
      markedAt: timeStr,
      notification: studentNotif,
    };
  }

  const timeStr = format(now, 'hh:mm a', { timeZone: TZ });
  return {
    success: true,
    markedBy: admin.name,
    markedAt: timeStr,
    notification: updated,
  };
}

// ─── Shared Business Logic: Force Checkout (Requirement 2) ───────────────────

export interface ForceCheckoutResult {
  session: ISession | null;
  durationMinutes: number;
  durationFormatted: string;
  alreadyCheckedOut: boolean;
}

/**
 * Shared atomic force checkout.
 * Used by adminController.forceCheckout and Telegram bot callbacks.
 * Uses atomic findOneAndUpdate with status: 'active'.
 */
export async function performForceCheckout(
  sessionId: string | mongoose.Types.ObjectId,
  options: { session?: mongoose.ClientSession; resolveAlerts?: boolean } = {}
): Promise<ForceCheckoutResult> {
  const now = new Date();

  let activeQuery = Session.findOne({ _id: sessionId, status: 'active' });
  if (options.session) activeQuery = activeQuery.session(options.session);
  const session = await activeQuery;
  if (!session) {
    let existingQuery = Session.findById(sessionId);
    if (options.session) existingQuery = existingQuery.session(options.session);
    const existing = await existingQuery;
    if (!existing) {
      return { session: null, durationMinutes: 0, durationFormatted: '', alreadyCheckedOut: false };
    }
    return {
      session: existing,
      durationMinutes: existing.durationMinutes || 0,
      durationFormatted: formatDuration(existing.durationMinutes || 0),
      alreadyCheckedOut: true,
    };
  }

  const durationMinutes = Math.max(0, diffMinutes(session.checkInAt, now));

  // Atomic checkout update
  const updated = await Session.findOneAndUpdate(
    { _id: sessionId, status: 'active' },
    {
      $set: {
        status: 'completed',
        checkoutType: 'forced',
        checkOutAt: now,
        durationMinutes,
      },
    },
    { new: true, ...(options.session && { session: options.session }) }
  );

  if (!updated) {
    let currentQuery = Session.findById(sessionId);
    if (options.session) currentQuery = currentQuery.session(options.session);
    const current = await currentQuery;
    return {
      session: current ?? session,
      durationMinutes: current?.durationMinutes ?? durationMinutes,
      durationFormatted: formatDuration(current?.durationMinutes ?? durationMinutes),
      alreadyCheckedOut: true,
    };
  }

  // Free seat and resolve any overtime alerts
  if (options.resolveAlerts !== false) await resolveOvertimeAlerts(updated._id);

  return {
    session: updated,
    durationMinutes,
    durationFormatted: formatDuration(durationMinutes),
    alreadyCheckedOut: false,
  };
}

// ─── Callback Query Dispatcher (Requirements 1, 2, 3, 8) ──────────────────────

export async function handleBotCallbackQuery(
  cbq: {
    id: string;
    from: { id: number | string };
    message?: {
      message_id: number;
      text?: string;
      chat: { id: number | string; type: string };
    };
    data?: string;
  },
  answer: typeof answerCallbackQuery = answerCallbackQuery,
  edit: typeof editMessageText = editMessageText
): Promise<void> {
  const fromId = String(cbq.from.id);
  const chatId = cbq.message?.chat?.id !== undefined ? String(cbq.message.chat.id) : fromId;
  const chatType = cbq.message?.chat?.type ?? 'private';
  const messageId = cbq.message?.message_id;
  const originalText = cbq.message?.text || '';
  const data = cbq.data ?? '';

  // Requirement 8: Authorize callbacks by checking both callback_query.from.id and message.chat.id
  if (chatType !== 'private' || fromId !== chatId) {
    await answer(cbq.id, '⛔ Unauthorized.');
    return;
  }

  const admin = await requireLinkedAdmin(fromId, 'private');
  if (!admin) {
    await answer(cbq.id, '⛔ Unauthorized.');
    return;
  }

  if (!messageId) {
    await answer(cbq.id, '⚠️ Message not found.');
    return;
  }

  // 1. "Mark as sent" callback: ot:sent:<sessionId>
  if (data.startsWith('ot:sent:')) {
    const sessionId = data.slice('ot:sent:'.length);
    const result = await recordManualNotificationSent({ sessionId, admin });

    if (result.notFound) {
      console.error(`[AdminBot] No student notification row found for session ${sessionId}.`);
      await answer(cbq.id, '⚠️ No student alert found for this session.');
      return;
    }

    if (result.alreadyMarked) {
      const msg = `Already marked by ${result.markedBy} at ${result.markedAt}`;
      await answer(cbq.id, msg);
      await edit(chatId, messageId, `${originalText}\n\nℹ️ ${msg}`, []);
      return;
    }

    const statusLine = `✅ Sent by ${admin.name}, ${result.markedAt}`;
    await answer(cbq.id, 'Marked as sent.');
    await edit(chatId, messageId, `${originalText}\n\n${statusLine}`, []);
    return;
  }

  // 2. "Force checkout" (Step 1: Ask "Are you sure?")
  if (data.startsWith('ot:force:')) {
    const sessionId = data.slice('ot:force:'.length);

    // Re-check session is still active
    const session = await Session.findOne({ _id: sessionId, status: 'active' }).populate<{ student: { name: string } }>(
      'student',
      'name'
    );

    if (!session) {
      await answer(cbq.id, 'Student already checked out.');
      await edit(chatId, messageId, `${originalText}\n\nℹ️ Student already checked out.`, []);
      return;
    }

    const studentName = session.student?.name || 'student';
    await answer(cbq.id);

    const confirmKeyboard: TelegramInlineButton[][] = [
      [
        { text: '✅ Confirm', callback_data: `ot:fok:${sessionId}` },
        { text: '❌ Cancel', callback_data: `ot:fcancel:${sessionId}` },
      ],
    ];

    const confirmPrompt = `${originalText}\n\n🚪 Force checkout ${escapeHtml(studentName)}? Are you sure?`;
    await edit(chatId, messageId, confirmPrompt, confirmKeyboard);
    return;
  }

  // 3. "Force checkout" (Step 2: Confirmed)
  if (data.startsWith('ot:fok:')) {
    const sessionId = data.slice('ot:fok:'.length);

    // Re-check session is still active & perform atomic checkout
    const result = await performForceCheckout(sessionId);

    if (result.alreadyCheckedOut) {
      await answer(cbq.id, 'Student already checked out.');
      await edit(chatId, messageId, `${originalText}\n\nℹ️ Student already checked out.`, []);
      return;
    }

    if (!result.session) {
      await answer(cbq.id, 'Session not found.');
      await edit(chatId, messageId, `${originalText}\n\n⚠️ Session not found.`, []);
      return;
    }

    const timeStr = format(new Date(), 'hh:mm a', { timeZone: TZ });
    const statusLine = `🚪 Checked out by ${admin.name}, ${timeStr} (${result.durationFormatted})`;

    await answer(cbq.id, 'Force checkout completed.');
    await edit(chatId, messageId, `${originalText}\n\n${statusLine}`, []);
    return;
  }

  // 4. "Force checkout" (Step 2: Cancelled)
  if (data.startsWith('ot:fcancel:')) {
    await answer(cbq.id, 'Cancelled.');
    await edit(chatId, messageId, `${originalText}\n\n❌ Cancelled by ${admin.name}.`, []);
    return;
  }

  // Unknown callback
  await answer(cbq.id, '⚠️ Unknown action.');
}
