import { config } from '../config';

export type LogLevel = 'info' | 'warn' | 'error';

export interface LogFields {
  sessionId?: string;
  notificationId?: string;
  [key: string]: unknown;
}

/** Remove the Telegram bot token (and anything shaped like one) from text before it is logged. */
export function redactSecrets(text: string): string {
  let out = text;
  const token = config.telegram.botToken;
  if (token) out = out.split(token).join('[redacted]');
  return out
    .replace(/bot\d{6,}:[A-Za-z0-9_-]{20,}/g, 'bot[redacted]')
    .replace(/\b\d{6,}:[A-Za-z0-9_-]{30,}\b/g, '[redacted]');
}

export function errorMessage(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return redactSecrets(raw);
}

/**
 * One-line structured log: `[tag] {"type":"...","level":"error",...}`.
 * Never pass tokens or PINs in `fields`; error messages are redacted automatically.
 */
export function logEvent(level: LogLevel, type: string, fields: LogFields = {}, error?: unknown): void {
  const payload: Record<string, unknown> = { type, level, ...fields };
  if (error !== undefined) {
    payload.errorName = error instanceof Error ? error.name : 'UnknownError';
    payload.errorMessage = errorMessage(error);
  }
  const line = redactSecrets(JSON.stringify(payload));
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.info(line);
}
