import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { configureStore } from '@reduxjs/toolkit';
import authReducer from './authSlice';
import { fetchMe } from './authThunks';
import { AUTH_CHECK_RETRY_DELAY_MS, isTransientStatus, shouldLogoutOnAuthCheckFailure } from './sessionRules';
import type { AuthUser } from '../types';
import type { AppDispatch } from '../store/store';

const user = { id: 'u1', name: 'Asha', phone: '9000000001', role: 'student', status: 'approved' } as unknown as AuthUser;

function makeStore(signedIn: boolean) {
  const store = configureStore({ reducer: { auth: authReducer } });
  if (signedIn) {
    // Seed a signed-in session the same way a successful account check would.
    store.dispatch(fetchMe.fulfilled(user, 'seed', undefined));
  }
  return store;
}

// The test store has only the auth slice, so give its dispatch the thunk-aware app type.
const checkAccount = (store: ReturnType<typeof makeStore>) => (store.dispatch as unknown as AppDispatch)(fetchMe());

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('logout rule', () => {
  it('logs out only for a real rejection of the session', () => {
    expect(shouldLogoutOnAuthCheckFailure(401)).toBe(true);
    expect(shouldLogoutOnAuthCheckFailure(403)).toBe(true);
  });

  it('never logs out for network errors, timeouts or server errors', () => {
    for (const status of [0, 408, 500, 502, 503, 504, undefined]) {
      expect(shouldLogoutOnAuthCheckFailure(status)).toBe(false);
    }
  });

  it('treats no-answer and 5xx as transient, and a clear 4xx as final', () => {
    expect(isTransientStatus(0)).toBe(true);
    expect(isTransientStatus(503)).toBe(true);
    expect(isTransientStatus(401)).toBe(false);
    expect(isTransientStatus(404)).toBe(false);
  });
});

describe('account check (fetchMe)', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('logs the user out on a real 401', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(401, { success: false, message: 'Session expired. Please log in again.' })));
    const store = makeStore(true);
    await checkAccount(store);
    expect(store.getState().auth.user).toBeNull();
    expect(store.getState().auth.connectionError).toBeNull();
  });

  it('keeps the user signed in after a network failure, and offers a retry', async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    vi.stubGlobal('fetch', fetchMock);
    const store = makeStore(true);
    const pending = checkAccount(store);
    await vi.advanceTimersByTimeAsync(AUTH_CHECK_RETRY_DELAY_MS + 10);
    await pending;
    expect(fetchMock).toHaveBeenCalledTimes(2); // one automatic retry
    expect(store.getState().auth.user).not.toBeNull();
    expect(store.getState().auth.connectionError).toMatch(/cannot reach the server/i);
  });

  it('keeps the user signed in after a 5xx error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(json(503, { success: false, message: 'Service unavailable' })));
    const store = makeStore(true);
    const pending = checkAccount(store);
    await vi.advanceTimersByTimeAsync(AUTH_CHECK_RETRY_DELAY_MS + 10);
    await pending;
    expect(store.getState().auth.user).not.toBeNull();
    expect(store.getState().auth.connectionError).toBeTruthy();
  });

  it('does not send a first-time visitor to login when the server is slow; it shows the retry state', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const store = makeStore(false);
    const pending = checkAccount(store);
    await vi.advanceTimersByTimeAsync(AUTH_CHECK_RETRY_DELAY_MS + 10);
    await pending;
    expect(store.getState().auth.bootstrapped).toBe(false);
    expect(store.getState().auth.connectionError).toBeTruthy();
  });

  it('recovers on the automatic retry when the first attempt hits a cold start', async () => {
    const fetchMock = vi
      .fn()
      .mockRejectedValueOnce(new TypeError('Failed to fetch'))
      .mockResolvedValueOnce(json(200, { success: true, data: user }));
    vi.stubGlobal('fetch', fetchMock);
    const store = makeStore(false);
    const pending = checkAccount(store);
    await vi.advanceTimersByTimeAsync(AUTH_CHECK_RETRY_DELAY_MS + 10);
    await pending;
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(store.getState().auth.user).toMatchObject({ id: 'u1' });
    expect(store.getState().auth.connectionError).toBeNull();
  });
});
