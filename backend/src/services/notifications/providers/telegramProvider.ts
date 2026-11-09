import {
  sendMessage,
  sendMessageHtml,
  TelegramInlineKeyboard,
} from './telegram';

export class TelegramProvider {
  async sendMessage(
    chatId: string,
    text: string,
    keyboard?: TelegramInlineKeyboard,
    parseMode?: 'HTML'
  ): Promise<void> {
    const result =
      parseMode === 'HTML'
        ? await sendMessageHtml(chatId, text, keyboard)
        : await sendMessage(chatId, text, keyboard);

    if (!result.ok) {
      const err = new Error(result.description ?? 'Telegram message could not be sent.');
      (err as any).errorCode = result.errorCode;
      (err as any).retryAfter = result.retryAfter;
      throw err;
    }
  }
}

export const telegramProvider = new TelegramProvider();
