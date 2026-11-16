import { createSlice } from '@reduxjs/toolkit';
import type { AuthUser } from '../types';
import { fetchMe, login, register, logout } from './authThunks';
import type { ThunkReject } from './createAppThunk';
import { shouldLogoutOnAuthCheckFailure } from './sessionRules';

interface AuthState {
  user: AuthUser | null;
  bootstrapped: boolean;
  submitting: boolean;
  error: string | null;
  errorStatus: number | null;
  fieldErrors?: { field: string; message: string }[];
  /** Set when the account check could not reach the server. The user is NOT logged out. */
  connectionError: string | null;
}

const initialState: AuthState = {
  user: null,
  bootstrapped: false,
  submitting: false,
  error: null,
  errorStatus: null,
  fieldErrors: undefined,
  connectionError: null,
};

function splitErr(p: ThunkReject | undefined): [number, string, { field: string; message: string }[] | undefined] {
  if (!p) return [0, 'Something went wrong. Please try again.', undefined];
  if (typeof p === 'object') {
    return [p.status ?? 0, p.message, p.errors];
  }
  const i = p.indexOf('|');
  if (i === -1) return [0, p, undefined];
  return [Number(p.slice(0, i)) || 0, p.slice(i + 1), undefined];
}

const authSlice = createSlice({
  name: 'auth',
  initialState,
  reducers: {
    sessionExpired(state) {
      state.user = null;
      state.bootstrapped = true;
      state.submitting = false;
      state.error = null;
      state.errorStatus = null;
      state.fieldErrors = undefined;
      state.connectionError = null;
    },
    clearAuthError(state) {
      state.error = null;
      state.errorStatus = null;
      state.fieldErrors = undefined;
    },
    userUpdated(state, a: { payload: Partial<AuthUser> }) {
      if (state.user) state.user = { ...state.user, ...a.payload };
    },
  },
  extraReducers: (b) => {
    b.addCase(fetchMe.pending, (s) => {
      s.connectionError = null;
    })
      .addCase(fetchMe.fulfilled, (s, a) => {
        s.user = a.payload;
        s.bootstrapped = true;
        s.connectionError = null;
      })
      .addCase(fetchMe.rejected, (s, a) => {
        const payload = a.payload;
        const status = typeof payload === 'object' ? payload.status : undefined;
        if (shouldLogoutOnAuthCheckFailure(status)) {
          s.user = null;
          s.bootstrapped = true;
          s.connectionError = null;
          return;
        }
        // Network error, timeout or server error: keep any signed-in user and offer a retry.
        s.connectionError =
          (typeof payload === 'object' ? payload.message : payload) ||
          'Could not reach the server. Please try again.';
      })
      .addCase(login.pending, (s) => {
        s.submitting = true;
        s.error = null;
        s.errorStatus = null;
      })
      .addCase(login.fulfilled, (s, a) => {
        s.submitting = false;
        s.user = a.payload;
        s.bootstrapped = true;
      })
      .addCase(login.rejected, (s, a) => {
        s.submitting = false;
        const [status, msg] = splitErr(a.payload);
        s.error = msg;
        s.errorStatus = status;
      })
      .addCase(register.pending, (s) => {
        s.submitting = true;
        s.error = null;
        s.errorStatus = null;
        s.fieldErrors = undefined;
      })
      .addCase(register.fulfilled, (s) => {
        s.submitting = false;
        s.fieldErrors = undefined;
      })
      .addCase(register.rejected, (s, a) => {
        s.submitting = false;
        const [status, msg, errs] = splitErr(a.payload);
        s.error = msg;
        s.errorStatus = status;
        s.fieldErrors = errs;
      })
      .addCase(logout.fulfilled, (s) => {
        s.user = null;
        s.bootstrapped = true;
        s.submitting = false;
        s.error = null;
        s.errorStatus = null;
        s.fieldErrors = undefined;
      })
      .addCase(logout.rejected, (s) => {
        s.user = null;
        s.bootstrapped = true;
        s.submitting = false;
        s.error = null;
        s.errorStatus = null;
        s.fieldErrors = undefined;
      });
  },
});

export const { sessionExpired, clearAuthError, userUpdated } = authSlice.actions;
export { logout } from './authThunks';

// Selectors
export const selectAuthUser = (s: { auth: AuthState }) => s.auth.user;
export const selectIsBootstrapped = (s: { auth: AuthState }) => s.auth.bootstrapped;
export const selectAuthError = (s: { auth: AuthState }) => s.auth.error;
export const selectAuthErrorStatus = (s: { auth: AuthState }) => s.auth.errorStatus;
export const selectAuthFieldErrors = (s: { auth: AuthState }) => s.auth.fieldErrors;
export const selectConnectionError = (s: { auth: AuthState }) => s.auth.connectionError;
export const selectAuthSubmitting = (s: { auth: AuthState }) => s.auth.submitting;

export default authSlice.reducer;
