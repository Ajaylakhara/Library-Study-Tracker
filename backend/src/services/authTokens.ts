import { CookieOptions, Response } from 'express';
import jwt from 'jsonwebtoken';
import { config } from '../config';

export const COOKIE_NAME = 'token';
export const SESSION_DAYS = 30;
export const SESSION_SECONDS = SESSION_DAYS * 24 * 60 * 60;
/** A token with less than this much life left is replaced by a fresh one while the app is in use. */
export const RENEW_BELOW_SECONDS = 15 * 24 * 60 * 60;

export function signSessionToken(userId: string, role: string, tokenVersion: number): string {
  return jwt.sign({ userId, role, tokenVersion }, config.jwt.secret, { expiresIn: SESSION_SECONDS });
}

/**
 * Same options for set and clear so the browser matches the cookie. 'lax' (not 'strict') lets the
 * session survive a normal link/redirect into the app; the API is same-origin through the /api proxy.
 */
export function sessionCookieOptions(): CookieOptions {
  return {
    httpOnly: true,
    secure: config.isProduction,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_SECONDS * 1000,
  };
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(COOKIE_NAME, token, sessionCookieOptions());
}

export function clearSessionCookie(res: Response): void {
  const { maxAge: _maxAge, ...options } = sessionCookieOptions();
  res.clearCookie(COOKIE_NAME, options);
}

/** True when a token (exp in seconds since epoch) has less than 15 days left. */
export function shouldRenewToken(exp: number | undefined, nowMs: number = Date.now()): boolean {
  if (typeof exp !== 'number') return false;
  return exp - Math.floor(nowMs / 1000) < RENEW_BELOW_SECONDS;
}
