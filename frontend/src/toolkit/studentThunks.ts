import { createAppThunk, errMsg } from './createAppThunk';
import { get, post } from '../store/api';
import { ENDPOINTS } from '../config/endpoints';
import type { ActiveSession, CheckOutResult, LastStudy } from '../types';
import { showToast } from './toastSlice';
import { formatMinutes } from '../helper/formatMinutes';

export const fetchStatus = createAppThunk('student/fetchStatus', async (_, { rejectWithValue }) => {
  try {
    const res = await get<{ activeSession: ActiveSession | null }>(ENDPOINTS.student.status);
    return res.data.activeSession;
  } catch (e) {
    return rejectWithValue(errMsg(e));
  }
});

export const fetchSeats = createAppThunk('student/fetchSeats', async (_, { rejectWithValue }) => {
  try {
    const res = await get<number[]>(ENDPOINTS.student.availableSeats);
    return res.data.map((number) => ({ number }));
  } catch (e) {
    return rejectWithValue(errMsg(e));
  }
});

export const checkIn = createAppThunk(
  'student/checkIn',
  async (selection: { seat: number; shiftHours: 4 | 12 | 24 }, { dispatch, rejectWithValue }) => {
    try {
      await post(ENDPOINTS.student.checkIn, selection);
      dispatch(showToast('success', 'Checked in successfully'));
      dispatch(fetchStatus());
      dispatch(fetchSeats());
      return true;
    } catch (e) {
      const status = (e as { status?: number }).status;
      if (status === 409) {
        dispatch(fetchSeats());
        dispatch(fetchStatus());
        const msg = errMsg(e);
        dispatch(showToast('error', msg));
        return rejectWithValue(msg);
      }
      dispatch(showToast('error', errMsg(e)));
      return rejectWithValue(errMsg(e));
    }
  }
);

export const checkOut = createAppThunk('student/checkOut', async (_, { dispatch, getState, rejectWithValue }) => {
  const current = getState().student.session;
  try {
    const res = await post<CheckOutResult>(ENDPOINTS.student.checkOut);
    dispatch(showToast('success', `Checked out. Study time: ${formatMinutes(res.data.durationMinutes)}`));
    dispatch(fetchSeats());
    return {
      ...res.data,
      seatNumber: current?.seatNumber ?? 0,
      checkInAt: current?.checkInAt ?? res.data.checkOutAt,
    } satisfies LastStudy;
  } catch (e) {
    if ((e as { status?: number }).status === 404) {
      dispatch(fetchStatus());
    }
    dispatch(showToast('error', errMsg(e)));
    return rejectWithValue(errMsg(e));
  }
});
