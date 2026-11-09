import { createHash } from 'crypto';
import { z } from 'zod';
import { User } from '../../models/User';
import {
  sendMessage,
  sendMessageHtml,
  sendReplyKeyboard,
} from './providers/telegram';
import {
  requireLinkedAdmin,
  handleLive,
  handleOvertime,
  handleHelp,
  handleBotCallbackQuery,
  ADMIN_REFUSAL_MESSAGE,
} from './adminBotHandlers';

export type TelegramSendMessage = (chatId: string, text: string) => Promise<unknown>;

const telegramUpdateSchema = z.object({
  message: z.object({
    text: z.string().optional(),
    chat: z.object({
      id: z.union([z.number(), z.string()]),
      type: z.string(),
    }).passthrough(),
  }).passthrough().optional(),
  callback_query: z.object({
    id: z.string(),
    from: z.object({
      id: z.union([z.number(), z.string()]),
    }).passthrough(),
    message: z.object({
      message_id: z.number(),
      chat: z.object({
        id: z.union([z.number(), z.string()]),
        type: z.string(),
      }).passthrough(),
    }).passthrough().optional(),
    data: z.string().optional(),
  }).passthrough().optional(),
}).passthrough();

const CODE_EXPIRED_MESSAGE = 'This link is wrong or expired. Create a new one in the app.';
const ADMIN_CONNECTED_MESSAGE = 'Connected. You will now receive library alerts here.';
const STUDENT_CONNECTED_MESSAGE = 'Connected. You will get reminders here.';
const START_MESSAGE = 'Open the library web app and press Connect Telegram to link this chat.';

export async function handleTelegramUpdate(
  update: unknown,
  send: TelegramSendMessage = sendMessage
): Promise<void> {
  const parsed = telegramUpdateSchema.safeParse(update);
  if (!parsed.success) return;

  // Handle callback_query (buttons)
  if (parsed.data.callback_query) {
    await handleBotCallbackQuery(parsed.data.callback_query as any);
    return;
  }

  const message = parsed.data.message;
  if (
    !message?.text ||
    message.chat?.id === undefined ||
    message.chat.type !== 'private'
  ) return;

  const chatId = String(message.chat.id);
  const rawText = message.text.trim();
  const parts = rawText.split(/\s+/);
  const normalizedCommand = parts[0].split('@')[0];

  // 1. /myid command (public)
  if (normalizedCommand === '/myid') {
    await send(chatId, `Your Telegram ID: ${chatId}`);
    return;
  }

  // 2. /start command (linking flow)
  if (normalizedCommand === '/start') {
    if (parts.length === 1) {
      await send(chatId, START_MESSAGE);
      return;
    }

    const code = parts[1];
    if (parts.length !== 2 || !/^[A-Za-z0-9_-]{20,64}$/.test(code)) {
      await send(chatId, CODE_EXPIRED_MESSAGE);
      return;
    }

    const codeHash = createHash('sha256').update(code).digest('hex');
    const now = new Date();
    const updatePipeline = [
      { $set: { telegramChatId: chatId, telegramLinkedAt: now } },
      { $unset: ['telegramLinkCodeHash', 'telegramLinkExpires'] },
    ];
    const linkQuery = {
      telegramLinkCodeHash: codeHash,
      telegramLinkExpires: { $gt: now },
      isDeleted: { $ne: true },
    };

    let linkedUser;
    try {
      linkedUser =
        (await User.findOneAndUpdate(
          { ...linkQuery, role: 'admin' },
          updatePipeline,
          { new: true }
        )) ??
        (await User.findOneAndUpdate(
          { ...linkQuery, role: 'student' },
          updatePipeline,
          { new: true }
        ));
    } catch (error) {
      if (
        typeof error === 'object' &&
        error !== null &&
        'code' in error &&
        error.code === 11000
      ) {
        await send(chatId, 'This Telegram account is already linked to another user.');
        return;
      }
      throw error;
    }

    if (!linkedUser) {
      await send(chatId, CODE_EXPIRED_MESSAGE);
      return;
    }

    await send(
      chatId,
      linkedUser.role === 'admin' ? ADMIN_CONNECTED_MESSAGE : STUDENT_CONNECTED_MESSAGE
    );
    return;
  }

  // 3. Admin commands (/live, /overtime, /help, and reply button labels)
  const isLive = normalizedCommand === '/live' || rawText === '📊 Live';
  const isOvertime = normalizedCommand === '/overtime' || rawText === '⏰ Overtime';
  const isHelp = normalizedCommand === '/help';

  if (isLive || isOvertime || isHelp) {
    const admin = await requireLinkedAdmin(chatId, message.chat.type);
    if (!admin) {
      await send(chatId, ADMIN_REFUSAL_MESSAGE);
      return;
    }

    // Configure dispatch functions based on whether send was customized
    const sendReply = send === sendMessage
      ? sendReplyKeyboard
      : async (cid: string, text: string) => {
          await send(cid, text);
          return { ok: true };
        };

    const sendMsg = send === sendMessage
      ? sendMessageHtml
      : async (cid: string, text: string) => {
          await send(cid, text);
          return { ok: true };
        };

    if (isLive) {
      await handleLive(chatId, sendReply, sendMsg);
      return;
    }

    if (isOvertime) {
      await handleOvertime(chatId, sendReply);
      return;
    }

    if (isHelp) {
      await handleHelp(chatId, sendReply);
      return;
    }
  }
}
