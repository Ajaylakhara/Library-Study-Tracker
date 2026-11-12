/**
 * Low-level Telegram Bot API wrappers.
 *
 * Key design decisions:
 *  - sendMessage accepts a mixed inline keyboard (URL buttons + callback buttons).
 *    Non-https URL buttons are silently dropped; callback buttons are always kept.
 *  - answerCallbackQuery must be called within 30 s of receiving a callback_query.
 *  - editMessageText catches "message is not modified" (400/Bad Request with that
 *    description) and "message not found" and treats them as ok:true so callers
 *    don't need to guard.
 *  - 403 (bot blocked) is treated as a permanent failure (errorCode 403).
 *  - 429 (rate-limited) is surfaced with retryAfter so the caller can back off.
 */

import { config } from '../../../config';
import { getLibraryNameOrDefault } from '../../librarySettings';

function escapeHtml(text: string): string {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

async function brandMessage(text: string, html: boolean): Promise<string> {
  const libraryName = await getLibraryNameOrDefault();
  const alreadyBranded = text.startsWith(`${libraryName}\n`);
  const prefix = html ? `<b>${escapeHtml(libraryName)}</b>\n` : `${libraryName}\n`;
  return alreadyBranded ? text : `${prefix}${text}`;
}

// ─── Button types ─────────────────────────────────────────────────────────────

export interface TelegramUrlButton {
  text: string;
  url: string;
}

export interface TelegramCallbackButton {
  text: string;
  callback_data: string;
}

/** One button is either a URL button OR a callback button. */
export type TelegramInlineButton = TelegramUrlButton | TelegramCallbackButton;

/** Either a 2D array of rows, or a 1D array of buttons (each placed on its own row). */
export type TelegramInlineKeyboard = TelegramInlineButton[][] | TelegramInlineButton[];

// ─── Result type ─────────────────────────────────────────────────────────────

export interface TelegramSendResult {
  ok: boolean;
  errorCode?: number;
  description?: string;
  /** Set on 429 responses so callers can sleep before retrying. */
  retryAfter?: number;
  /** message_id of the sent message, when available. */
  messageId?: number;
}

export interface TelegramBotCommand {
  command: string;
  description: string;
}

// ─── Internal types ───────────────────────────────────────────────────────────

interface TelegramApiResponse {
  ok?: boolean;
  error_code?: number;
  description?: string;
  parameters?: { retry_after?: number };
  result?: { message_id?: number } | boolean;
}

function logTelegramError(method: string, errorCode: number | undefined, description: string): void {
  console.error(
    `[TelegramAPI] ${method} failed${errorCode === undefined ? '' : ` (code=${errorCode})`}: ${description}`
  );
}

// ─── Keyboard builder ─────────────────────────────────────────────────────────

function normalizeKeyboard(keyboard: TelegramInlineKeyboard): TelegramInlineButton[][] {
  if (keyboard.length === 0) return [];
  if (Array.isArray(keyboard[0])) {
    return keyboard as TelegramInlineButton[][];
  }
  return (keyboard as TelegramInlineButton[]).map((btn) => [btn]);
}

function buildInlineKeyboard(keyboard: TelegramInlineKeyboard): object | null {
  const normalized = normalizeKeyboard(keyboard);
  const rows = normalized
    .map((row) =>
      row
        .filter(Boolean)
        .map((btn) => {
          if ('callback_data' in btn) {
            return { text: btn.text, callback_data: btn.callback_data };
          }
          // URL buttons must use https:// — drop http:// and others silently
          return btn.url.startsWith('https://') ? { text: btn.text, url: btn.url } : null;
        })
        .filter((b): b is NonNullable<typeof b> => b !== null)
    )
    .filter((row) => row.length > 0);

  return rows.length > 0 ? { inline_keyboard: rows } : null;
}

// ─── Core fetch wrapper ───────────────────────────────────────────────────────

async function callTelegramApi(
  method: string,
  body: Record<string, unknown>
): Promise<TelegramSendResult & { raw?: TelegramApiResponse }> {
  const { botToken } = config.telegram;
  if (!botToken) {
    const description = 'Telegram is not configured.';
    logTelegramError(method, undefined, description);
    return { ok: false, description };
  }

  let response: Response;
  try {
    response = await fetch(`https://api.telegram.org/bot${botToken}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
  } catch (error) {
    logTelegramError(
      method,
      undefined,
      `request failed (${error instanceof Error ? error.name : 'UnknownError'}).`
    );
    return { ok: false, description: 'Telegram API request failed.' };
  }

  let result: TelegramApiResponse;
  try {
    result = (await response.json()) as TelegramApiResponse;
  } catch {
    logTelegramError(method, response.status, 'Telegram API returned an invalid response.');
    return {
      ok: false,
      errorCode: response.status,
      description: 'Telegram API returned an invalid response.',
    };
  }

  // 403 — bot blocked by user: permanent failure, do not retry
  if (response.status === 403 || result.error_code === 403) {
    logTelegramError(method, 403, result.description ?? 'bot blocked by user');
    return { ok: false, errorCode: 403, description: 'bot blocked by user', raw: result };
  }

  // 429 — rate limited: surface retry_after
  if (response.status === 429 || result.error_code === 429) {
    const retryAfter = result.parameters?.retry_after ?? 1;
    logTelegramError(method, 429, result.description ?? `rate limited; retry after ${retryAfter}s`);
    return {
      ok: false,
      errorCode: 429,
      description: `Too many requests. Retry after ${retryAfter}s.`,
      retryAfter,
      raw: result,
    };
  }

  if (!response.ok || !result.ok) {
    const errorCode = result.error_code ?? response.status;
    const description = result.description ?? 'Telegram API request failed.';
    logTelegramError(method, errorCode, description);
    return {
      ok: false,
      errorCode,
      description,
      raw: result,
    };
  }

  const msgId =
    result.result !== null &&
    typeof result.result === 'object' &&
    'message_id' in result.result
      ? result.result.message_id
      : undefined;

  return { ok: true, messageId: msgId, raw: result };
}

export async function setMyCommands(
  commands: TelegramBotCommand[],
  scope?: Record<string, unknown>
): Promise<TelegramSendResult> {
  const result = await callTelegramApi('setMyCommands', {
    commands,
    ...(scope ? { scope } : {}),
  });
  return { ok: result.ok, errorCode: result.errorCode, description: result.description };
}

export async function deleteMyCommands(
  scope: Record<string, unknown>
): Promise<TelegramSendResult> {
  const result = await callTelegramApi('deleteMyCommands', { scope });
  return { ok: result.ok, errorCode: result.errorCode, description: result.description };
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Sends a Telegram message, optionally with an inline keyboard.
 * Non-https URL buttons are silently dropped.
 * Does NOT use parse_mode — callers who need HTML should pass parse_mode in a
 * future extension; existing callers send plain text.
 */
export async function sendMessage(
  chatId: string,
  text: string,
  keyboard?: TelegramInlineKeyboard
): Promise<TelegramSendResult> {
  text = await brandMessage(text, false);
  const body: Record<string, unknown> = { chat_id: chatId, text };
  if (keyboard && keyboard.length > 0) {
    const replyMarkup = buildInlineKeyboard(keyboard);
    if (replyMarkup) body.reply_markup = replyMarkup;
  }
  const r = await callTelegramApi('sendMessage', body);
  return { ok: r.ok, errorCode: r.errorCode, description: r.description, retryAfter: r.retryAfter, messageId: r.messageId };
}

/**
 * Sends a Telegram message with HTML parse mode and an optional inline keyboard.
 * Text must be escaped with escapeHtml() before passing.
 */
export async function sendMessageHtml(
  chatId: string,
  text: string,
  keyboard?: TelegramInlineKeyboard
): Promise<TelegramSendResult> {
  text = await brandMessage(text, true);
  const body: Record<string, unknown> = { chat_id: chatId, text, parse_mode: 'HTML' };
  if (keyboard && keyboard.length > 0) {
    const replyMarkup = buildInlineKeyboard(keyboard);
    if (replyMarkup) body.reply_markup = replyMarkup;
  }
  const r = await callTelegramApi('sendMessage', body);
  return { ok: r.ok, errorCode: r.errorCode, description: r.description, retryAfter: r.retryAfter, messageId: r.messageId };
}

/**
 * Sends a message with a persistent reply keyboard (shown below the text input).
 */
export async function sendReplyKeyboard(
  chatId: string,
  text: string,
  keyboardRows: string[][],
  parseMode?: 'HTML'
): Promise<TelegramSendResult> {
  text = await brandMessage(text, parseMode === 'HTML');
  const body: Record<string, unknown> = {
    chat_id: chatId,
    text,
    ...(parseMode ? { parse_mode: parseMode } : {}),
    reply_markup: {
      keyboard: keyboardRows.map((row) => row.map((label) => ({ text: label }))),
      resize_keyboard: true,
      one_time_keyboard: false,
    },
  };
  const r = await callTelegramApi('sendMessage', body);
  return { ok: r.ok, errorCode: r.errorCode, description: r.description };
}

/**
 * Answers a callback query. Must be called within 30 s.
 * @param text Optional toast text shown to the user (≤200 chars).
 */
export async function answerCallbackQuery(
  callbackQueryId: string,
  text?: string
): Promise<TelegramSendResult> {
  const body: Record<string, unknown> = { callback_query_id: callbackQueryId };
  if (text) body.text = text.slice(0, 200);
  const r = await callTelegramApi('answerCallbackQuery', body);
  return { ok: r.ok, errorCode: r.errorCode, description: r.description };
}

/**
 * Edits the text (and optionally the inline keyboard) of an existing message.
 *
 * "message is not modified" and "message to edit not found" are treated as
 * ok:true because they are non-fatal for our use-cases (idempotent double-press,
 * deleted message).
 *
 * Pass an empty array for keyboard to remove all buttons.
 */
export async function editMessageText(
  chatId: string,
  messageId: number,
  text: string,
  keyboard?: TelegramInlineKeyboard
): Promise<TelegramSendResult> {
  text = await brandMessage(text, true);
  const body: Record<string, unknown> = {
    chat_id: chatId,
    message_id: messageId,
    text,
    parse_mode: 'HTML',
  };

  if (keyboard !== undefined) {
    // Pass empty inline_keyboard to remove buttons; pass null markup to leave unchanged.
    body.reply_markup = buildInlineKeyboard(keyboard) ?? { inline_keyboard: [] };
  }

  const r = await callTelegramApi('editMessageText', body);

  if (!r.ok && r.raw) {
    const desc = (r.raw.description ?? '').toLowerCase();
    // These are non-fatal
    if (
      desc.includes('message is not modified') ||
      desc.includes('message to edit not found') ||
      desc.includes('message not found')
    ) {
      return { ok: true };
    }
  }

  return { ok: r.ok, errorCode: r.errorCode, description: r.description, retryAfter: r.retryAfter };
}
