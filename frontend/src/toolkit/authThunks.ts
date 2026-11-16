import { createAppThunk, errMsg } from './createAppThunk';
import { ApiError, get, post } from '../store/api';
import { ENDPOINTS } from '../config/endpoints';
import type { AuthUser, LoginInput, RegisterInput } from '../types';
import { showToast } from './toastSlice';
import { AUTH_CHECK_RETRY_DELAY_MS, isTransientStatus, statusOf } from './sessionRules';

/**
 * Loads the signed-in account. A network error, timeout (cold start) or 5xx is retried once
 * and then rejected WITH its status, so the slice can tell "server unreachable" from "session over".
 */
export const fetchMe = createAppThunk('auth/fetchMe', async (_, { rejectWithValue }) => {
  try {
    try {
      return (await get<AuthUser>(ENDPOINTS.auth.me)).data;
    } catch (first) {
      if (!isTransientStatus(statusOf(first))) throw first;
      await new Promise((resolve) => setTimeout(resolve, AUTH_CHECK_RETRY_DELAY_MS));
      return (await get<AuthUser>(ENDPOINTS.auth.me)).data;
    }
  } catch (e) {
    return rejectWithValue({ message: errMsg(e), status: statusOf(e) });
  }
});

export const login = createAppThunk(
  'auth/login',
  async (body: LoginInput, { dispatch, rejectWithValue }) => {
    try {
      const res = await post<AuthUser>(ENDPOINTS.auth.login, body as unknown as Record<string, unknown>);
      dispatch(fetchMe());
      return res.data;
    } catch (e) {
      const status = (e as { status?: number }).status ?? 0;
      return rejectWithValue(`${status}|${errMsg(e)}`);
    }
  }
);

export const register = createAppThunk(
  'auth/register',
  async (body: RegisterInput, { dispatch, rejectWithValue }) => {
    try {
      const res = await post(ENDPOINTS.auth.register, body as unknown as Record<string, unknown>);
      dispatch(showToast('success', 'Registered. Waiting for admin approval.'));
      return res.message ?? 'Registration submitted. Please wait for admin approval.';
    } catch (e) {
      if (e instanceof ApiError) {
        return rejectWithValue({
          message: e.message,
          status: e.status,
          errors: e.errors,
        });
      }
      const status = (e as { status?: number }).status ?? 0;
      return rejectWithValue(`${status}|${errMsg(e)}`);
    }
  }
);

export const logout = createAppThunk('auth/logout', async () => {
  try {
    await post(ENDPOINTS.auth.logout);
  } catch {
    /* cookie may already be gone */
  }
});
