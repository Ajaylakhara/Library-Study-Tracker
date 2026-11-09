import { createSlice, nanoid, type PayloadAction } from '@reduxjs/toolkit';
import type { RootState } from '../store/store';

export type ToastType = 'success' | 'error' | 'info' | 'warning';

export interface Toast {
  id: string;
  type: ToastType;
  message: string;
}

const MAX_TOASTS = 3;

const toastSlice = createSlice({
  name: 'toast',
  initialState: [] as Toast[],
  reducers: {
    showToast: {
      reducer: (state, a: PayloadAction<Toast>) => {
        if (state.some((t) => t.message === a.payload.message)) return; // no duplicates
        state.push(a.payload);
        if (state.length > MAX_TOASTS) state.shift();
      },
      prepare: (type: ToastType, message: string) => ({
        payload: { id: nanoid(), type, message },
      }),
    },
    dismissToast: (state, a: PayloadAction<string>) => state.filter((t) => t.id !== a.payload),
    clearToasts: () => [],
  },
  extraReducers: (builder) => {
    builder
      .addCase('auth/logout/fulfilled', () => [])
      .addCase('auth/sessionExpired', () => []);
  },
});

export const { showToast, dismissToast, clearToasts } = toastSlice.actions;

// Selectors
export const selectToasts = (state: RootState) => state.toast;

export default toastSlice.reducer;
