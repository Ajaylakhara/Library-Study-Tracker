import { configureStore } from '@reduxjs/toolkit';
import authReducer, { sessionExpired } from '../toolkit/authSlice';
import studentReducer from '../toolkit/studentSlice';
import adminReducer from '../toolkit/adminSlice';
import toastReducer, { showToast } from '../toolkit/toastSlice';
import { setUnauthorizedHandler } from './api';
import brandingReducer from '../toolkit/brandingSlice';
import { loadBranding } from '../toolkit/brandingThunks';

export const store = configureStore({
  reducer: {
    auth: authReducer,
    student: studentReducer,
    admin: adminReducer,
    toast: toastReducer,
    branding: brandingReducer,
  },
});

export type RootState = ReturnType<typeof store.getState>;
export type AppDispatch = typeof store.dispatch;

// A 401 on any non-auth call means the cookie expired or the user was removed.
setUnauthorizedHandler(() => {
  if (store.getState().auth.user) {
    store.dispatch(sessionExpired());
    store.dispatch(showToast('error', 'Session expired. Please log in again.'));
  }
});

void store.dispatch(loadBranding());
