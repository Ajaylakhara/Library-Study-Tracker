import { createAsyncThunk } from '@reduxjs/toolkit';
import type { AppDispatch, RootState } from '../store/store';

export interface RejectPayload {
  message: string;
  status?: number;
  errors?: { field: string; message: string }[];
}

export type ThunkReject = string | RejectPayload;

/** Every thunk rejects with a plain, user-readable string or structured payload. */
export const createAppThunk = createAsyncThunk.withTypes<{
  state: RootState;
  dispatch: AppDispatch;
  rejectValue: ThunkReject;
}>();

export function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : 'Something went wrong. Please try again.';
}

