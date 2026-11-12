import { afterEach, describe, expect, it, vi } from 'vitest';
import { http, setUnauthorizedHandler } from './api';

describe('API session expiry handling', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    setUnauthorizedHandler(() => {});
  });

  it('does not expire a session when a current PIN is incorrect', async () => {
    const unauthorized = vi.fn();
    setUnauthorizedHandler(unauthorized);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: false, message: 'Current PIN is incorrect.' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    ));

    await expect(http('POST', '/admin/account/change-phone', { currentPin: '000000' }))
      .rejects.toThrow('Current PIN is incorrect.');

    expect(unauthorized).not.toHaveBeenCalled();
  });

  it('expires the session when the server rejects an expired login cookie', async () => {
    const unauthorized = vi.fn();
    setUnauthorizedHandler(unauthorized);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ success: false, message: 'Session expired. Please log in again.' }), {
        status: 401,
        headers: { 'Content-Type': 'application/json' },
      })
    ));

    await expect(http('GET', '/admin/account')).rejects.toThrow('Session expired.');

    expect(unauthorized).toHaveBeenCalledTimes(1);
  });
});
