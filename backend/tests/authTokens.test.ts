import { describe, expect, it } from '@jest/globals';
import jwt from 'jsonwebtoken';
import { config } from '../src/config';
import {
  RENEW_BELOW_SECONDS,
  SESSION_SECONDS,
  sessionCookieOptions,
  shouldRenewToken,
  signSessionToken,
} from '../src/services/authTokens';

const DAY = 24 * 60 * 60;

describe('session cookie options', () => {
  it('is httpOnly, lax, site-wide and lasts 30 days', () => {
    const options = sessionCookieOptions();
    expect(options.httpOnly).toBe(true);
    expect(options.sameSite).toBe('lax');
    expect(options.path).toBe('/');
    expect(options.maxAge).toBe(30 * DAY * 1000);
  });

  it('is secure exactly when running in production', () => {
    expect(sessionCookieOptions().secure).toBe(config.isProduction);
  });
});

describe('session token', () => {
  it('lasts 30 days and carries the user, role and token version', () => {
    const token = signSessionToken('user-1', 'admin', 3);
    const decoded = jwt.verify(token, config.jwt.secret) as {
      userId: string;
      role: string;
      tokenVersion: number;
      iat: number;
      exp: number;
    };
    expect(decoded).toMatchObject({ userId: 'user-1', role: 'admin', tokenVersion: 3 });
    expect(decoded.exp - decoded.iat).toBe(SESSION_SECONDS);
    expect(SESSION_SECONDS).toBe(30 * DAY);
  });

  it('is rejected when tampered with or signed with another secret', () => {
    const token = signSessionToken('user-1', 'student', 0);
    const tampered = `${token.slice(0, -2)}${token.endsWith('aa') ? 'bb' : 'aa'}`;
    expect(() => jwt.verify(tampered, config.jwt.secret)).toThrow();
    const foreign = jwt.sign({ userId: 'user-1', role: 'admin' }, 'some-other-secret-value-0123456789abcdef');
    expect(() => jwt.verify(foreign, config.jwt.secret)).toThrow();
  });

  it('is rejected once expired', () => {
    const expired = jwt.sign({ userId: 'user-1', role: 'student' }, config.jwt.secret, { expiresIn: -10 });
    expect(() => jwt.verify(expired, config.jwt.secret)).toThrow(/expired/i);
  });
});

describe('sliding renewal rule', () => {
  const nowMs = Date.UTC(2026, 2, 10, 12, 0, 0);
  const nowSec = Math.floor(nowMs / 1000);

  it('renews a token with less than 15 days left', () => {
    expect(RENEW_BELOW_SECONDS).toBe(15 * DAY);
    expect(shouldRenewToken(nowSec + 14 * DAY, nowMs)).toBe(true);
    expect(shouldRenewToken(nowSec + 1, nowMs)).toBe(true);
  });

  it('keeps a token with 15 days or more left', () => {
    expect(shouldRenewToken(nowSec + 15 * DAY, nowMs)).toBe(false);
    expect(shouldRenewToken(nowSec + 29 * DAY, nowMs)).toBe(false);
  });

  it('does nothing when the token has no expiry', () => {
    expect(shouldRenewToken(undefined, nowMs)).toBe(false);
  });
});
