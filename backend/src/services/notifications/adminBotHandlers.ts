/**
 * Admin bot command handlers, callback handlers, and shared business operations.
 *
 * Implements:
 *  - requireLinkedAdmin: single authorization helper checking private chat, admin role,
 *    approved status, not blocked, not soft-deleted, with linked telegramChatId.
 *  - handleHelp: lists admin bot commands.
 *  - handleLive, handlePending, handleUnpaidFees: admin list views and actions.
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
import { TOTAL_SEATS } from '../../models/Seat';
import { Session } from '../../models/Session';
import { Notification, INotification } from '../../models/Notification';
import { Fee } from '../../models/Fee';
import { config } from '../../config';
import { performForceCheckout } from '../forceCheckout';
export { performForceCheckout } from '../forceCheckout';
import { enqueueFeeReminder, markFeePaid, updateStudentStatus } from '../adminActions';
import { diffMinutes, formatDuration, previousMonthString, toMonthString, TZ } from '../../utils/time';
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

export const ADMIN_KEYBOARD_ROWS = [
  ['👥 Live seats', '⏱ Overtime'],
  ['📝 Pending requests', '💰 Unpaid fees'],
];
export const ADMIN_REFUSAL_MESSAGE = '⛔ This bot is only accessible to authorized administrators.';

export function homeKeyboard(): TelegramInlineKeyboard {
  return [[{ text: '🏠 Menu', callback_data: callbackData('menu', '0') }]];
}

export function menuInlineKeyboard(): TelegramInlineKeyboard {
  return [
    [
      { text: '👥 Live seats', callback_data: callbackData('menu_live', '0') },
      { text: '⏱ Overtime', callback_data: callbackData('menu_overtime', '0') },
    ],
    [
      { text: '📝 Pending requests', callback_data: callbackData('menu_pending', '0') },
      { text: '💰 Unpaid fees', callback_data: callbackData('menu_unpaid', '0') },
    ],
  ];
}

function withHomeButton(keyboard?: TelegramInlineKeyboard): TelegramInlineKeyboard {
  const rows: TelegramInlineButton[][] = !keyboard || keyboard.length === 0
    ? []
    : Array.isArray(keyboard[0])
      ? keyboard as TelegramInlineButton[][]
      : (keyboard as TelegramInlineButton[]).map((button) => [button]);
  return [...rows, ...homeKeyboard() as TelegramInlineButton[][]];
}

export function callbackData(action: string, id: string): string {
  const data = `${action}:${id}`;
  if (Buffer.byteLength(data, 'utf8') > 64) {
    throw new Error('Telegram callback_data must not exceed 64 bytes.');
  }
  return data;
}

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
  sendReply: typeof sendReplyKeyboard = sendReplyKeyboard,
  sendMsg: typeof sendMessageHtml = sendMessageHtml
): Promise<void> {
  const text =
    '📚 <b>Admin Bot Help</b>\n\n' +
    'Available commands:\n' +
    '• /menu — Open the admin menu\n' +
    '• /live — View current occupancy\n' +
    '• /pending — Review pending registrations\n' +
    '• /unpaid — Review unpaid fees\n' +
    '• /overtime — View students past their shift end\n' +
    '• /help — Show this help message\n' +
    '• /myid — Show your Telegram chat ID\n\n' +
    '<i>Tap the buttons below for quick access.</i>';

  await sendReply(chatId, text, ADMIN_KEYBOARD_ROWS, 'HTML');
  await sendMsg(chatId, 'Open the admin menu:', menuInlineKeyboard());
}

export async function handleAdminMenu(
  chatId: string,
  sendMsg: typeof sendMessageHtml = sendMessageHtml,
  sendReply: typeof sendReplyKeyboard = sendReplyKeyboard
): Promise<void> {
  await sendReply(chatId, 'Admin shortcuts are available on your keyboard:', ADMIN_KEYBOARD_ROWS);
  await sendMsg(chatId, '<b>Admin control panel</b>', menuInlineKeyboard());
}

/**
 * /live command handler:
 * Shows occupancy counts and checked-in students with time remaining.
 */
export async function handleLive(
  chatId: string,
  sendMsg: typeof sendMessageHtml = sendMessageHtml
): Promise<void> {
  const now = new Date();

  const activeSessions = await Session.find({ status: 'active' })
      .populate<{ student: { name: string } }>('student', 'name')
      .populate<{ seat: { number: number } }>('seat', 'number')
      .sort({ shiftEndsAt: 1 });

  const count = activeSessions.length;
  const overtimeCount = activeSessions.filter((session) => session.shiftEndsAt < now).length;
  const freeSeats = Math.max(0, TOTAL_SEATS - count);
  const lines = activeSessions.map((session) => {
    const name = escapeHtml(session.student?.name || 'Unknown');
    const seatNumber = session.seat?.number ?? '?';
    const minutes = Math.floor((session.shiftEndsAt.getTime() - now.getTime()) / 60000);
    const timeLeft = minutes < 0 ? `${Math.abs(minutes)}m overtime` : `${formatDuration(minutes)} left`;
    return `• Seat ${seatNumber} · ${name} · ${timeLeft}`;
  });
  const text = [
    '<b>Live Study Status</b>',
    `Checked in: ${count} · Overtime: ${overtimeCount} · Free: ${freeSeats}`,
    '',
    ...(lines.length ? lines : ['No students are checked in.']),
  ].join('\n');
  await sendMsg(chatId, text, withHomeButton([
    [{ text: '🔄 Refresh', callback_data: callbackData('live_refresh', '0') }],
  ]));
}

export async function handlePending(
  chatId: string,
  sendMsg: typeof sendMessageHtml = sendMessageHtml
): Promise<void> {
  const students = await User.find({
    role: 'student',
    status: 'pending',
    isDeleted: false,
  }).sort({ createdAt: -1 }).limit(25);

  if (students.length === 0) {
    await sendMsg(chatId, '📝 <b>Pending requests</b>\n\nNo pending registrations.', homeKeyboard());
    return;
  }

  for (const student of students) {
    const text =
      `📝 <b>${escapeHtml(student.name)}</b>\n` +
      `Phone: ${escapeHtml(student.phone ?? '—')}\n` +
      `Seat: ${student.seatNumber ?? '—'} · Shift: ${student.shiftHours ?? '—'}h`;
    await sendMsg(chatId, text, withHomeButton([[
      { text: '✅ Approve', callback_data: callbackData('student_approve', student._id.toString()) },
      { text: '❌ Reject', callback_data: callbackData('student_reject', student._id.toString()) },
    ]]));
  }
}

export async function handleUnpaidFees(
  chatId: string,
  sendMsg: typeof sendMessageHtml = sendMessageHtml
): Promise<void> {
  const months = [toMonthString(new Date()), previousMonthString()];
  const [fees, summaries] = await Promise.all([
    Fee.find({ status: 'unpaid', month: { $in: months } })
      .sort({ month: -1, createdAt: -1 })
      .limit(25)
      .populate<{ student: { _id: mongoose.Types.ObjectId; name: string; phone?: string } }>(
        'student',
        'name phone'
      ),
    Fee.aggregate<{ total: number; count: number }>([
      { $match: { status: 'unpaid', month: { $in: months } } },
      { $group: { _id: null, total: { $sum: '$amount' }, count: { $sum: 1 } } },
    ]),
  ]);
  const summary = summaries[0] ?? { total: 0, count: 0 };

  if (summary.count === 0) {
    await sendMsg(chatId, `💰 <b>Unpaid fees</b>\n\nNo unpaid fees for ${months.join(' or ')}.`, homeKeyboard());
    return;
  }

  await sendMsg(
    chatId,
    `💰 <b>Unpaid fees</b> (${summary.count} records; showing ${fees.length})\n` +
      `Total pending: ₹${summary.total.toLocaleString('en-IN')}`,
      homeKeyboard()
  );
  for (const fee of fees) {
    const student = fee.student;
    const text =
      `💰 <b>${escapeHtml(student?.name ?? 'Former student')}</b>\n` +
      `Month: ${fee.month} · Amount: ₹${fee.amount.toLocaleString('en-IN')}\n` +
      `Phone: ${escapeHtml(student?.phone ?? '—')}`;
    await sendMsg(chatId, text, withHomeButton([[
      { text: '✔ Mark paid', callback_data: callbackData('fee_paid', fee._id.toString()) },
      { text: '📩 Send reminder', callback_data: callbackData('fee_remind', fee._id.toString()) },
    ]]));
  }
}

/**
 * /overtime command handler:
 * Shows active sessions past shiftEndsAt with minutes over.
 */
export async function handleOvertime(
  chatId: string,
  sendMsg: typeof sendMessageHtml = sendMessageHtml
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
    await sendMsg(chatId, text, homeKeyboard());
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

  await sendMsg(chatId, text, homeKeyboard());
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
    { text: '✅ Mark as sent', callback_data: callbackData('ot_sent', sessionId) },
    { text: '🚪 Force checkout', callback_data: callbackData('ot_force', sessionId) },
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
  const rawData = cbq.data ?? '';
  let answered = false;
  const answerOnce = async (text?: string): Promise<void> => {
    if (answered) return;
    answered = true;
    await answer(cbq.id, text);
  };

  try {
    if (chatType !== 'private' || fromId !== chatId) {
      await answerOnce('⛔ Unauthorized.');
      return;
    }

    const admin = await requireLinkedAdmin(fromId, 'private');
    if (!admin) {
      await answerOnce('⛔ Unauthorized.');
      return;
    }
    if (!messageId) {
      await answerOnce('⚠️ Message not found.');
      return;
    }

    let action: string;
    let id: string;
    const legacy = rawData.match(/^ot:(sent|force|fok|fcancel):([^:]+)$/);
    if (legacy) {
      action = ({ sent: 'ot_sent', force: 'ot_force', fok: 'ot_checkout_yes', fcancel: 'ot_checkout_no' } as const)[
        legacy[1] as 'sent' | 'force' | 'fok' | 'fcancel'
      ];
      id = legacy[2];
    } else {
      const match = rawData.match(/^([a-z_]+):([A-Za-z0-9_-]+)$/);
      if (!match) {
        await answerOnce('⚠️ Unknown action.');
        return;
      }
      [, action, id] = match;
    }

    const complete = async (
      answerText: string,
      messageText: string,
      keyboard: TelegramInlineKeyboard = homeKeyboard()
    ): Promise<void> => {
      await answerOnce(answerText);
      await edit(chatId, messageId, messageText, keyboard);
    };

    if (action === 'menu' && id === '0') {
      await complete('Admin menu.', '<b>Admin control panel</b>', menuInlineKeyboard());
      return;
    }

    if (action === 'menu_live' || action === 'menu_overtime' || action === 'menu_pending' || action === 'menu_unpaid' || action === 'live_refresh') {
      let firstOutput = true;
      const render = async (
        targetChatId: string,
        text: string,
        keyboard?: TelegramInlineKeyboard
      ): Promise<TelegramSendResult> => {
        const finalKeyboard = keyboard ?? homeKeyboard();
        if (firstOutput) {
          firstOutput = false;
          return edit(targetChatId, messageId, text, finalKeyboard);
        }
        return sendMessageHtml(targetChatId, text, finalKeyboard);
      };

      await answerOnce(action === 'live_refresh' ? 'Updated.' : 'Opening menu item.');
      if (action === 'menu_live' || action === 'live_refresh') await handleLive(chatId, render);
      else if (action === 'menu_overtime') await handleOvertime(chatId, render);
      else if (action === 'menu_pending') await handlePending(chatId, render);
      else await handleUnpaidFees(chatId, render);
      return;
    }

    const finalKeyboard = homeKeyboard();

    if (action === 'student_approve') {
      const result = await updateStudentStatus(id, 'approved', config.defaultMonthlyFee, 'pending');
      const feeWarning = config.defaultMonthlyFee === 0
        ? '\n\n⚠️ Monthly fee is ₹0, set it on the website or no fee will be generated.'
        : '';
      const suffix = result.alreadyHandled
        ? '\n\nℹ️ Already handled.'
        : `\n\n✅ Approved by ${escapeHtml(admin.name)}.`;
      await complete(
        result.alreadyHandled ? 'Already handled' : 'Approved.',
        `${originalText}${suffix}${feeWarning}`,
        finalKeyboard
      );
      return;
    }

    if (action === 'student_reject') {
      const student = await User.findOne({ _id: id, role: 'student', isDeleted: false });
      if (!student || student.status !== 'pending') {
        await complete('Already handled', `${originalText}\n\nℹ️ Already handled.`);
        return;
      }
      const keyboard: TelegramInlineKeyboard = withHomeButton([[
        { text: '✅ Yes, reject', callback_data: callbackData('student_reject_yes', id) },
        { text: '↩ No', callback_data: callbackData('student_reject_no', id) },
      ]]);
      await answerOnce('Confirm rejection.');
      await edit(
        chatId,
        messageId,
        `${originalText}\n\nReject ${escapeHtml(student.name)}?`,
        keyboard
      );
      return;
    }

    if (action === 'student_reject_yes') {
      const result = await updateStudentStatus(id, 'rejected', undefined, 'pending');
      await complete(
        result.alreadyHandled ? 'Already handled' : 'Rejected.',
        `${originalText}\n\n${result.alreadyHandled ? 'ℹ️ Already handled.' : `❌ Rejected by ${escapeHtml(admin.name)}.`}`
      );
      return;
    }

    if (action === 'student_reject_no') {
      await complete('Cancelled.', `${originalText}\n\nRejection cancelled.`);
      return;
    }

    if (action === 'fee_paid') {
      const result = await markFeePaid(id, admin._id);
      await complete(
        result.alreadyHandled ? 'Already handled' : 'Marked paid.',
        `${originalText}\n\n${result.alreadyHandled ? 'ℹ️ Already handled.' : `✅ Marked paid by ${escapeHtml(admin.name)}.`}`
      );
      return;
    }

    if (action === 'fee_remind') {
      await enqueueFeeReminder(id);
      await complete('Reminder queued.', `${originalText}\n\n📩 Reminder queued.`);
      return;
    }

    if (action === 'ot_sent') {
      const result = await recordManualNotificationSent({ sessionId: id, admin });
      if (result.notFound) {
        await complete('No student alert found.', `${originalText}\n\n⚠️ No student alert found for this session.`);
        return;
      }
      if (result.alreadyMarked) {
        const msg = `Already marked by ${result.markedBy} at ${result.markedAt}`;
        await complete(msg, `${originalText}\n\nℹ️ ${msg}`);
        return;
      }
      await complete(
        'Marked as sent.',
        `${originalText}\n\n✅ Sent by ${escapeHtml(admin.name)}, ${result.markedAt}`
      );
      return;
    }

    if (action === 'ot_force') {
      const session = await Session.findOne({ _id: id, status: 'active' })
        .populate<{ student: { name: string } }>('student', 'name');
      if (!session) {
        await complete('Already handled', `${originalText}\n\nℹ️ Already handled: student checked out.`);
        return;
      }
      const keyboard: TelegramInlineKeyboard = withHomeButton([[
        { text: '✅ Confirm', callback_data: callbackData('ot_checkout_yes', id) },
        { text: '❌ Cancel', callback_data: callbackData('ot_checkout_no', id) },
      ]]);
      await answerOnce('Confirm force checkout.');
      await edit(
        chatId,
        messageId,
        `${originalText}\n\nForce checkout ${escapeHtml(session.student?.name || 'student')}? Are you sure?`,
        keyboard
      );
      return;
    }

    if (action === 'ot_checkout_yes') {
      const result = await performForceCheckout(id);
      if (result.alreadyCheckedOut) {
        await complete('Already handled', `${originalText}\n\nℹ️ Already handled: student checked out.`);
        return;
      }
      if (!result.session) {
        await complete('Session not found.', `${originalText}\n\n⚠️ Session not found.`);
        return;
      }
      const timeStr = format(new Date(), 'hh:mm a', { timeZone: TZ });
      await complete(
        'Force checkout completed.',
        `${originalText}\n\n🚪 Checked out by ${escapeHtml(admin.name)}, ${timeStr} (${result.durationFormatted})`
      );
      return;
    }

    if (action === 'ot_checkout_no') {
      await complete('Cancelled.', `${originalText}\n\n❌ Cancelled by ${escapeHtml(admin.name)}.`);
      return;
    }

    await answerOnce('⚠️ Unknown action.');
  } catch (error) {
    const errorStatus =
      typeof error === 'object' && error !== null && 'statusCode' in error
        ? Number(error.statusCode)
        : 500;
    const message = errorStatus < 500 && error instanceof Error
      ? error.message
      : 'Action failed. Please try again.';
    await answerOnce(message.slice(0, 200));
    if (messageId) {
      await edit(chatId, messageId, `${originalText}\n\n⚠️ ${escapeHtml(message)}`, []);
    }
    throw error;
  } finally {
    if (!answered) await answerOnce();
  }
}
