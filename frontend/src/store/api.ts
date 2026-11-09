import { ENV } from '../config/env';
import { ApiError, extractErrorMessage, isApiError } from './errors';
import type { ApiFieldError, ApiErrorPayload } from './errors';

export { ApiError, isApiError, extractErrorMessage };
export type { ApiFieldError, ApiErrorPayload };

let onUnauthorized: (() => void) | null = null;
/** The store registers this so a 401 anywhere logs the user out. */
export function setUnauthorizedHandler(fn: () => void): void {
  onUnauthorized = fn;
}

const AUTH_PATHS = ['/auth/login', '/auth/register', '/auth/me', '/auth/logout'];
const REQUEST_TIMEOUT_MS = 20000;

export interface Envelope<T> {
  success: boolean;
  message?: string;
  data: T;
  count?: number;
  unreadCount?: number;
  pagination?: { page: number; limit: number; total: number; pages: number };
}

export type Query = Record<string, string | number | boolean | undefined>;

function buildUrl(path: string, query?: Query): string {
  const cleanBase = ENV.apiUrl.replace(/\/+$/, '');
  const cleanPath = path.startsWith('/') ? path : `/${path}`;
  let url = `${cleanBase}${cleanPath}`;

  if (query) {
    const qs = new URLSearchParams();
    Object.entries(query).forEach(([k, v]) => {
      if (v !== undefined && v !== '') qs.set(k, String(v));
    });
    const s = qs.toString();
    if (s) url += `?${s}`;
  }

  return url;
}

export async function http<T = unknown>(
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE' | 'PUT',
  path: string,
  body?: Record<string, unknown>,
  query?: Query
): Promise<Envelope<T>> {
  const url = buildUrl(path, query);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, {
      method,
      credentials: 'include',
      headers: {
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
      signal: controller.signal,
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new ApiError('Server is taking too long. Please try again.', 0);
    }
    throw new ApiError('Cannot reach the server. Check your connection.', 0);
  } finally {
    clearTimeout(timeoutId);
  }

  const json = await res.json().catch(() => null);
  if (!res.ok) {
    const payload = json as ApiErrorPayload | null;
    const message = extractErrorMessage(payload, 'Something went wrong. Please try again.');
    // 401 = cookie expired; 403 "blocked" = admin blocked this student mid-session.
    const ended = res.status === 401 || (res.status === 403 && /blocked/i.test(message));
    if (ended && !AUTH_PATHS.includes(path)) {
      onUnauthorized?.();
    }
    throw new ApiError(message, res.status, payload?.errors, payload);
  }
  return json as Envelope<T>;
}

export const get = <T>(path: string, query?: Query) => http<T>('GET', path, undefined, query);
export const post = <T>(path: string, body?: Record<string, unknown>) => http<T>('POST', path, body ?? {});
export const patch = <T>(path: string, body: Record<string, unknown>) => http<T>('PATCH', path, body);
export const del = <T>(path: string) => http<T>('DELETE', path);

export async function downloadFile(
  path: string,
  filename: string,
  query?: Record<string, string | number | undefined>
): Promise<void> {
  const url = buildUrl(path, query);

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(url, {
      credentials: 'include',
      signal: controller.signal,
    });
  } catch (err: unknown) {
    if (err instanceof Error && err.name === 'AbortError') {
      throw new ApiError('Server is taking too long. Please try again.', 0);
    }
    throw new ApiError('Cannot reach the server. Check your connection.', 0);
  } finally {
    clearTimeout(timeoutId);
  }

  if (!res.ok) {
    throw new ApiError('Could not download the file.', res.status);
  }

  const blob = await res.blob();
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}
