import { createSlice } from '@reduxjs/toolkit';
import type { ActiveSession, FreeSeat, LastStudy } from '../types';
import { fetchStatus, fetchSeats, checkIn, checkOut } from './studentThunks';
import { sessionExpired } from './authSlice';
import { logout } from './authThunks';

interface StudentState {
  session: ActiveSession | null;
  statusLoaded: boolean;
  statusError: string | null;
  seats: FreeSeat[];
  seatsLoaded: boolean;
  seatsError: string | null;
  busy: boolean;
  lastStudy: LastStudy | null;
}

const initialState: StudentState = {
  session: null,
  statusLoaded: false,
  statusError: null,
  seats: [],
  seatsLoaded: false,
  seatsError: null,
  busy: false,
  lastStudy: null,
};

const studentSlice = createSlice({
  name: 'student',
  initialState,
  reducers: {
    dismissLastStudy(state) {
      state.lastStudy = null;
    },
  },
  extraReducers: (b) => {
    b.addCase(fetchStatus.fulfilled, (s, a) => {
      s.session = a.payload;
      s.statusLoaded = true;
      s.statusError = null;
      if (a.payload) s.lastStudy = null;
    })
      .addCase(fetchStatus.rejected, (s, a) => {
        s.statusError = (typeof a.payload === 'string' ? a.payload : a.payload?.message) ?? 'Could not load your status.';
        s.statusLoaded = true;
      })
      .addCase(fetchSeats.pending, (s) => {
        s.seatsError = null;
      })
      .addCase(fetchSeats.fulfilled, (s, a) => {
        s.seats = a.payload;
        s.seatsLoaded = true;
        s.seatsError = null;
      })
      .addCase(fetchSeats.rejected, (s, a) => {
        s.seatsError = (typeof a.payload === 'string' ? a.payload : a.payload?.message) ?? 'Could not load seats.';
        s.seatsLoaded = true;
      })
      .addCase(checkIn.pending, (s) => {
        s.busy = true;
      })
      .addCase(checkIn.fulfilled, (s) => {
        s.busy = false;
        s.lastStudy = null;
      })
      .addCase(checkIn.rejected, (s) => {
        s.busy = false;
      })
      .addCase(checkOut.pending, (s) => {
        s.busy = true;
      })
      .addCase(checkOut.fulfilled, (s, a) => {
        s.busy = false;
        s.session = null;
        s.lastStudy = a.payload;
      })
      .addCase(checkOut.rejected, (s) => {
        s.busy = false;
      })
      .addCase(logout.fulfilled, () => initialState)
      .addCase(sessionExpired, () => initialState);
  },
});

export const { dismissLastStudy } = studentSlice.actions;

// Selectors
export const selectStudentSession = (s: { student: StudentState }) => s.student.session;
export const selectStudentStatusLoaded = (s: { student: StudentState }) => s.student.statusLoaded;
export const selectStudentStatusError = (s: { student: StudentState }) => s.student.statusError;
export const selectStudentSeats = (s: { student: StudentState }) => s.student.seats;
export const selectStudentSeatsLoaded = (s: { student: StudentState }) => s.student.seatsLoaded;
export const selectStudentBusy = (s: { student: StudentState }) => s.student.busy;
export const selectLastStudy = (s: { student: StudentState }) => s.student.lastStudy;

export default studentSlice.reducer;
