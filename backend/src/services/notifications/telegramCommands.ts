import { User } from '../../models/User';
import {
  deleteMyCommands,
  setMyCommands,
  TelegramBotCommand,
} from './providers/telegram';

export const DEFAULT_TELEGRAM_COMMANDS: TelegramBotCommand[] = [
  { command: 'start', description: 'Connect your account' },
  { command: 'myid', description: 'Show your Telegram chat ID' },
];

export const ADMIN_TELEGRAM_COMMANDS: TelegramBotCommand[] = [
  { command: 'live', description: 'View live seats' },
  { command: 'pending', description: 'Review pending requests' },
  { command: 'unpaid', description: 'Review unpaid fees' },
  { command: 'overtime', description: 'View students in overtime' },
  { command: 'menu', description: 'Open the admin menu' },
  { command: 'myid', description: 'Show your Telegram chat ID' },
];

export function reportCommandFailure(action: string, chatId: string, result: { ok: boolean; description?: string }): void {
  if (!result.ok) {
    console.error(
      `[TelegramCommands] ${action} failed for chat ${chatId}: ${result.description ?? 'Unknown Telegram API error.'}`
    );
  }
}

export async function registerAdminChatCommands(chatId: string): Promise<boolean> {
  const result = await setMyCommands(ADMIN_TELEGRAM_COMMANDS, {
    type: 'chat',
    chat_id: chatId,
  });
  reportCommandFailure('setMyCommands', chatId, result);
  return result.ok;
}

export async function removeAdminChatCommands(chatId: string): Promise<boolean> {
  const result = await deleteMyCommands({
    type: 'chat',
    chat_id: chatId,
  });
  reportCommandFailure('deleteMyCommands', chatId, result);
  return result.ok;
}

export async function setDefaultTelegramCommands(): Promise<boolean> {
  const result = await setMyCommands(DEFAULT_TELEGRAM_COMMANDS);
  reportCommandFailure('setMyCommands default scope', 'default', result);
  return result.ok;
}

export async function registerLinkedAdminCommands(): Promise<{ total: number; failed: number }> {
  const admins = await User.find({
    role: 'admin',
    status: 'approved',
    isDeleted: false,
    telegramChatId: { $exists: true, $ne: null },
  }).select('+telegramChatId');

  let failed = 0;
  for (const admin of admins) {
    if (!admin.telegramChatId || !(await registerAdminChatCommands(admin.telegramChatId))) {
      failed++;
    }
  }
  return { total: admins.length, failed };
}
