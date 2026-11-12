import mongoose from 'mongoose';
import { BotState } from '../../models/BotState';
import { Fee } from '../../models/Fee';
import { User } from '../../models/User';
import { generateMonthlyFees } from '../../jobs/monthlyFees';
import { createError } from '../../middleware/errorHandler';
import { getLibraryNameOrDefault } from '../librarySettings';
import { markSent, prepareReminder, ReminderChannel, sendReminder } from '../feeReminderService';
import { listFees, summarizeFees } from '../feeQueries';
import { toMonthString } from '../../utils/time';
import { TelegramInlineButton, TelegramInlineKeyboard, TelegramSendResult } from './providers/telegram';

const STATE_TTL_MS = 5 * 60 * 1000;
const MAX_SEARCH_RESULTS = 8;
const ACTIVE_STUDENT_FILTER = { role: 'student', status: 'approved', isDeleted: false } as const;

export type FeeBotRender = (
  text: string,
  keyboard?: TelegramInlineKeyboard
) => Promise<TelegramSendResult>;

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function cb(action: string, id: string): string {
  const data = `${action}:${id}`;
  if (Buffer.byteLength(data, 'utf8') > 64) throw new Error('Telegram callback_data must not exceed 64 bytes.');
  return data;
}

function phoneSearchDigits(query: string): string {
  let digits = query.replace(/\D/g, '');
  if (digits.startsWith('0091') && digits.length > 10) digits = digits.slice(4);
  else if (digits.startsWith('91') && digits.length > 10) digits = digits.slice(2);
  return digits;
}

export function escapeRegex(query: string): string {
  return query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export async function beginFeeSearch(chatId: string): Promise<void> {
  await BotState.findOneAndUpdate(
    { chatId },
    { $set: { action: 'fee_search', expiresAt: new Date(Date.now() + STATE_TTL_MS) } },
    { upsert: true, new: true, setDefaultsOnInsert: true }
  );
}

export async function cancelFeeBotState(chatId: string): Promise<void> {
  await BotState.deleteOne({ chatId });
}

export async function consumeFeeSearch(chatId: string, query: string, render: FeeBotRender): Promise<void> {
  const state = await BotState.findOne({ chatId, action: 'fee_search', expiresAt: { $gt: new Date() } });
  await cancelFeeBotState(chatId);
  if (!state) return;

  const cleaned = query.trim();
  if (!cleaned || cleaned.startsWith('/')) {
    await render('Please send a student name or phone number to search.', [
      [{ text: '🔍 Search again', callback_data: cb('fee_search', '0') }],
      [{ text: '🏠 Menu', callback_data: cb('menu', '0') }],
    ]);
    return;
  }
  await searchFeeStudents(cleaned, render);
}

export async function showFeeSearchPrompt(render: FeeBotRender): Promise<void> {
  await render('Send the student’s name or phone number.', [
    [{ text: '🏠 Menu', callback_data: cb('menu', '0') }],
  ]);
}

export async function showFeeMenu(render: FeeBotRender): Promise<void> {
  await render('<b>💰 Fees</b>\nChoose an action.', [
    [
      { text: '🔍 Search student', callback_data: cb('fee_search', '0') },
      { text: '📋 All unpaid', callback_data: cb('menu_unpaid', '0') },
    ],
    [{ text: '🏠 Menu', callback_data: cb('menu', '0') }],
  ]);
}

export async function searchFeeStudents(query: string, render: FeeBotRender): Promise<void> {
  const namePattern = escapeRegex(query.trim());
  const phoneDigits = phoneSearchDigits(query);
  const conditions: Record<string, unknown>[] = [
    { name: { $regex: namePattern, $options: 'i' } },
  ];
  if (phoneDigits) {
    const formattedPhonePattern = phoneDigits.split('').map(escapeRegex).join('\\D*');
    conditions.push({ phone: { $regex: formattedPhonePattern } });
  }

  const students = await User.find({
    ...ACTIVE_STUDENT_FILTER,
    $or: conditions,
  })
    .sort({ name: 1 })
    .limit(MAX_SEARCH_RESULTS + 1);

  if (students.length > MAX_SEARCH_RESULTS) {
    await render('Too many students matched. Please search with a narrower name or phone number.', [
      [{ text: '🔍 Search again', callback_data: cb('fee_search', '0') }],
      [{ text: '🏠 Menu', callback_data: cb('menu', '0') }],
    ]);
    return;
  }
  if (!students.length) {
    await render('No approved student matched that name or phone number.', [
      [{ text: '🔍 Search again', callback_data: cb('fee_search', '0') }],
      [{ text: '🏠 Menu', callback_data: cb('menu', '0') }],
    ]);
    return;
  }

  const keyboard: TelegramInlineButton[][] = students.map((student) => [{
    text: `${student.name} · ${student.phone ?? '—'} · Seat ${student.seatNumber ?? '—'}`,
    callback_data: cb('fee_s', student._id.toString()),
  }]);
  keyboard.push([{ text: '🔍 Search again', callback_data: cb('fee_search', '0') }]);
  keyboard.push([{ text: '🏠 Menu', callback_data: cb('menu', '0') }]);
  await render(`Found ${students.length} student${students.length === 1 ? '' : 's'}:`, keyboard);
}

export async function showFeeStudent(userId: string, render: FeeBotRender): Promise<void> {
  if (!mongoose.isValidObjectId(userId)) throw createError('Student not found.', 404);
  const student = await User.findOne({
    _id: userId,
    ...ACTIVE_STUDENT_FILTER,
  }).select('+telegramChatId');
  if (!student) throw createError('Student not found.', 404);

  const [records, totals, libraryName] = await Promise.all([
    listFees({ studentId: userId }, { limit: 6 }),
    summarizeFees({ status: 'unpaid', studentId: userId }),
    getLibraryNameOrDefault(),
  ]);
  const unpaid = records.fees.filter((fee) => fee.status === 'unpaid');
  const lastReminder = records.fees
    .filter((fee) => fee.lastReminderAt)
    .sort((a, b) => (b.lastReminderAt?.getTime() ?? 0) - (a.lastReminderAt?.getTime() ?? 0))[0];
  const lines = [
    `👤 <b>${escapeHtml(student.name)}</b>`,
    `Phone: ${escapeHtml(student.phone ?? '—')}`,
    `Seat: ${student.seatNumber ?? '—'} · Shift: ${student.shiftHours ? `${student.shiftHours}h` : '—'}`,
    `Monthly fee: ₹${student.monthlyFee.toLocaleString('en-IN')}`,
    `Preferred channel: ${escapeHtml(student.preferredChannel)} · Telegram linked: ${student.telegramChatId ? 'Yes' : 'No'}`,
    `Total due: ₹${totals.total.toLocaleString('en-IN')}`,
    lastReminder?.lastReminderAt
      ? `Last reminder: ${lastReminder.lastReminderAt.toLocaleString('en-IN')} · ${lastReminder.lastReminderChannel ?? '—'}`
      : 'Last reminder: Not reminded',
    '',
    `<b>Recent fees · ${escapeHtml(libraryName)}</b>`,
    ...records.fees.map((fee) =>
      `${escapeHtml(fee.month)} · ₹${fee.amount.toLocaleString('en-IN')} · ${fee.status === 'paid' ? 'PAID' : 'UNPAID'}`
    ),
    ...(records.fees.length ? [] : ['No fee records.']),
  ];

  const keyboard: TelegramInlineButton[][] = [];
  for (const fee of unpaid) {
    keyboard.push([
      { text: `💰 Mark ${fee.month} paid`, callback_data: cb('fee_paid', fee._id.toString()) },
      { text: `📩 Remind ${fee.month}`, callback_data: cb('fee_remind', fee._id.toString()) },
    ]);
  }
  if (!records.fees.length) {
    const month = toMonthString(new Date());
    keyboard.push([{ text: `Create ${month} fee`, callback_data: cb('fee_create', userId) }]);
  }
  keyboard.push([{ text: '⬅ Back', callback_data: cb('fee_back', '0') }]);
  keyboard.push([{ text: '🏠 Menu', callback_data: cb('menu', '0') }]);
  await render(lines.join('\n'), keyboard);
}

export async function showFeeReminderOptions(feeId: string, render: FeeBotRender): Promise<void> {
  const reminder = await prepareReminder({ feeId });
  const channels: ReminderChannel[] = reminder.channels;
  const when = reminder.lastReminder
    ? `\n\n⚠️ Last reminder: ${reminder.lastReminder.sentAt.toLocaleString('en-IN')}, ${reminder.lastReminder.channel}. Confirm if you want to send another.`
    : '';
  const buttons = channels.map((channel) => ({
    text: `${channel === reminder.preferredChannel ? '★ ' : ''}${channel === 'whatsapp' ? '💬 WhatsApp' : channel === 'sms' ? '📱 SMS' : '✈️ Telegram'}`,
    callback_data: cb(
      reminder.lastReminder ? `fee_confirm_${channel}` : `fee_send_${channel}`,
      reminder.feeId
    ),
  }));
  const rows: TelegramInlineButton[][] = [];
  for (let i = 0; i < buttons.length; i += 2) rows.push(buttons.slice(i, i + 2));
  rows.push([{ text: '⬅ Back', callback_data: cb('fee_s', reminder.studentId) }]);
  rows.push([{ text: '🏠 Menu', callback_data: cb('menu', '0') }]);
  await render(
    `<b>Fee reminder · ${escapeHtml(reminder.studentName)}</b>\n` +
      `${escapeHtml(reminder.month)} · ₹${reminder.amount.toLocaleString('en-IN')} · Total due ₹${reminder.totalDue.toLocaleString('en-IN')}\n\n` +
      `<pre>${escapeHtml(reminder.message)}</pre>${when}`,
    rows
  );
}

export async function sendFeeReminderFromBot(
  feeId: string,
  channel: ReminderChannel,
  adminId: mongoose.Types.ObjectId | string,
  confirmRecent: boolean,
  render: FeeBotRender
): Promise<void> {
  const result = await sendReminder({
    feeId,
    channel,
    adminId,
    confirmRecent,
  });
  if (result.confirmationRequired) {
    const prepared = await prepareReminder({ feeId });
    const rows: TelegramInlineButton[][] = prepared.channels.map((item) => [{
      text: `Confirm ${item === 'whatsapp' ? 'WhatsApp' : item === 'sms' ? 'SMS' : 'Telegram'}`,
      callback_data: cb(`fee_confirm_${item}`, feeId),
    }]);
    rows.push([{ text: '🏠 Menu', callback_data: cb('menu', '0') }]);
    await render(
      `⚠️ A reminder was sent within the last 24 hours. Last reminder: ${result.lastReminder?.sentAt.toLocaleString('en-IN')}, ${result.lastReminder?.channel}.\n\nSend another?`,
      rows
    );
    return;
  }
  if (result.telegramSent) {
    const prepared = await prepareReminder({ feeId });
    await render('✅ Reminder sent on Telegram.', [
      [{ text: '⬅ Back to student', callback_data: cb('fee_s', prepared.studentId) }],
      [{ text: '🏠 Menu', callback_data: cb('menu', '0') }],
    ]);
    return;
  }

  const buttons: TelegramInlineButton[][] = [];
  if (result.url) {
    buttons.push([{
      text: result.channel === 'whatsapp' ? '💬 Open WhatsApp' : '📱 Open secure SMS page',
      url: result.url,
    }]);
  }
  if (result.notificationId) {
    buttons.push([{
      text: '✔ Mark sent',
      callback_data: cb('fee_reminder_sent', result.notificationId),
    }]);
  }
  const prepared = await prepareReminder({ feeId });
  buttons.push([{ text: '⬅ Back to student', callback_data: cb('fee_s', prepared.studentId) }]);
  buttons.push([{ text: '🏠 Menu', callback_data: cb('menu', '0') }]);
  await render('Reminder prepared. Open the link to send it, then mark it sent here.', buttons);
}

export async function markFeeReminderSentFromBot(
  notificationId: string,
  adminId: mongoose.Types.ObjectId | string,
  render: FeeBotRender
): Promise<void> {
  const result = await markSent(notificationId, adminId);
  await render(
    result.alreadySent ? 'ℹ️ Reminder was already marked as sent.' : '✅ Reminder marked as sent.',
    [[{ text: '🏠 Menu', callback_data: cb('menu', '0') }]]
  );
}

export async function confirmCreateCurrentFee(userId: string, render: FeeBotRender): Promise<void> {
  const student = await User.findOne({ _id: userId, ...ACTIVE_STUDENT_FILTER });
  if (!student) throw createError('Student not found.', 404);
  const month = toMonthString(new Date());
  await render(
    `Create the ${month} fee of ₹${student.monthlyFee.toLocaleString('en-IN')} for ${escapeHtml(student.name)}?`,
    [[
      { text: '✅ Yes, create', callback_data: cb('fee_create_yes', userId) },
      { text: 'No', callback_data: cb('fee_create_no', userId) },
    ], [{ text: '🏠 Menu', callback_data: cb('menu', '0') }]]
  );
}

export async function createCurrentFeeForStudent(userId: string, render: FeeBotRender): Promise<void> {
  if (!mongoose.isValidObjectId(userId)) throw createError('Student not found.', 404);
  const student = await User.findOne({ _id: userId, ...ACTIVE_STUDENT_FILTER });
  if (!student) throw createError('Student not found.', 404);
  if (student.monthlyFee <= 0) throw createError('Set a monthly fee on the student record before generating a fee.', 409);

  const result = await generateMonthlyFees(toMonthString(new Date()), userId);
  const status = result.created ? '✅ Fee created.' : 'ℹ️ A fee for this month already exists.';
  await render(`${status}\n${escapeHtml(student.name)} · ₹${student.monthlyFee.toLocaleString('en-IN')}`, [
    [{ text: '👤 View student', callback_data: cb('fee_s', userId) }],
    [{ text: '🏠 Menu', callback_data: cb('menu', '0') }],
  ]);
}

export async function cancelFeeSearchIfExpired(chatId: string): Promise<void> {
  await BotState.deleteMany({ chatId, expiresAt: { $lte: new Date() } });
}

export const feeBotConstants = { STATE_TTL_MS, MAX_SEARCH_RESULTS };
