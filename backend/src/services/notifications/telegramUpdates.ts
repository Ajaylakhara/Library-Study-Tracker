import { createHash } from 'crypto';
import { z } from 'zod';
import { User } from '../../models/User';
import { BotState } from '../../models/BotState';
import {
  sendMessage,
  sendMessageHtml,
  sendReplyKeyboard,
  TelegramInlineKeyboard,
  TelegramSendResult,
} from './providers/telegram';
import {
  requireLinkedAdmin,
  handleLive,
  handleOvertime,
  handleHelp,
  handleBotCallbackQuery,
  handleAdminMenu,
  handlePending,
  handleUnpaidFees,
  ADMIN_REFUSAL_MESSAGE,
} from './adminBotHandlers';
import { registerAdminChatCommands } from './telegramCommands';
import {
  beginFeeSearch,
  cancelFeeBotState,
  consumeFeeSearch,
  searchFeeStudents,
  showFeeSearchPrompt,
} from './feeBotHandlers';

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
const ADMIN_CONNECTED_MESSAGE = 'Connected. You will now receive alerts here.';
const STUDENT_CONNECTED_MESSAGE = 'Connected. You will get reminders here.';
const START_MESSAGE = 'Open the web app and press Connect Telegram to link this chat.';

export async function handleTelegramUpdate(
  update: unknown,
  send: TelegramSendMessage = sendMessage,
  registerAdminCommands: typeof registerAdminChatCommands = registerAdminChatCommands
): Promise<void> {
  const parsed = telegramUpdateSchema.safeParse(update);
  if (!parsed.success) return;

  // Handle callback_query (buttons)
  if (parsed.data.callback_query) {
    await handleBotCallbackQuery(parsed.data.callback_query);
    return;
  }

  const message = parsed.data.message;
  if (
    !message?.text ||
    message.chat?.id === undefined
  ) return;

  const chatId = String(message.chat.id);
  const rawText = message.text.trim();
  const parts = rawText.split(/\s+/);
  const normalizedCommand = parts[0].split('@')[0];

  if (message.chat.type !== 'private') return;

  // /start is the one-time account-linking flow; all operational updates below
  // require a linked, active administrator.
  if (normalizedCommand === '/start') {
    if (message.chat.type !== 'private') return;
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
    if (linkedUser.role === 'admin' && linkedUser.status === 'approved' && !linkedUser.isDeleted) {
      await registerAdminCommands(chatId);
    }
    return;
  }

  // Admin commands and persistent reply-keyboard labels
  const isMenu = normalizedCommand === '/menu';
  const isLive = normalizedCommand === '/live' || rawText === '👥 Live seats';
  const isPending = normalizedCommand === '/pending' || rawText === '📝 Pending requests';
  const isUnpaid = normalizedCommand === '/unpaid' || rawText === '💰 Unpaid fees';
  const isFees = normalizedCommand === '/fees' || rawText === '💰 Fees';
  const isOvertime = normalizedCommand === '/overtime' || rawText === '⏱ Overtime' || rawText === '⏰ Overtime';
  const isHelp = normalizedCommand === '/help';
  const isMyId = normalizedCommand === '/myid';

  const admin = await requireLinkedAdmin(chatId, message.chat.type);
  if (!admin) {
    await send(chatId, ADMIN_REFUSAL_MESSAGE);
    return;
  }

  const sendReply = send === sendMessage
    ? sendReplyKeyboard
    : async (cid: string, text: string) => {
        await send(cid, text);
        return { ok: true };
      };

  const sendHtml = send === sendMessage
    ? sendMessageHtml
    : async (cid: string, text: string) => {
        await send(cid, text);
        return { ok: true };
      };
  const renderFeeMessage = (
    text: string,
    keyboard?: TelegramInlineKeyboard
  ): Promise<TelegramSendResult> => sendHtml(chatId, text, keyboard);

  const isCommand = normalizedCommand.startsWith('/');
  if (isMyId) {
    await send(chatId, `Your Telegram ID: ${chatId}`);
    return;
  }
  if (isFees) {
    await cancelFeeBotState(chatId);
    const query = normalizedCommand === '/fees' ? parts.slice(1).join(' ').trim() : '';
    if (query) await searchFeeStudents(query, renderFeeMessage);
    else {
      await beginFeeSearch(chatId);
      await showFeeSearchPrompt(renderFeeMessage);
    }
    return;
  }

  if (isMenu || isLive || isPending || isUnpaid || isOvertime || isHelp) {
    await cancelFeeBotState(chatId);
    if (isMenu) {
      await handleAdminMenu(chatId, sendHtml, sendReply);
      return;
    }
    if (isLive) {
      await handleLive(chatId, sendHtml);
      return;
    }
    if (isPending) {
      await handlePending(chatId, sendHtml);
      return;
    }
    if (isUnpaid) {
      await handleUnpaidFees(chatId, sendHtml);
      return;
    }
    if (isOvertime) {
      await handleOvertime(chatId, sendHtml);
      return;
    }
    if (isHelp) {
      await handleHelp(chatId, sendReply, sendHtml);
      return;
    }
  }

  if (isCommand) {
    await cancelFeeBotState(chatId);
    return;
  }
  const pendingSearch = await BotState.exists({
    chatId,
    action: 'fee_search',
    expiresAt: { $gt: new Date() },
  });
  if (pendingSearch) {
    await consumeFeeSearch(chatId, rawText, renderFeeMessage);
  }
}
