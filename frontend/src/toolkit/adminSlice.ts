import { createSlice } from '@reduxjs/toolkit';
import type { LiveSeat, Student, AdminSession, AdminFee, ReportSummary, StudentReportRow, Pagination } from '../types';
import {
  fetchLiveSeats,
  fetchStudents,
  fetchSessions,
  fetchFees,
  fetchReportSummary,
  fetchReportStudents,
  forceCheckoutSession,
  markFeePaid,
  deleteStudent,
} from './adminThunks';
import { sessionExpired } from './authSlice';
import { logout } from './authThunks';

interface AdminState {
  liveSeats: LiveSeat[];
  liveSeatsLoading: boolean;
  students: Student[];
  studentsPagination: Pagination | null;
  studentsLoading: boolean;
  sessions: AdminSession[];
  sessionsPagination: Pagination | null;
  sessionsLoading: boolean;
  fees: AdminFee[];
  feesPagination: Pagination | null;
  feesLoading: boolean;
  reportSummary: ReportSummary | null;
  reportSummaryLoading: boolean;
  reportStudents: StudentReportRow[];
  reportStudentsLoading: boolean;
}

const initialState: AdminState = {
  liveSeats: [],
  liveSeatsLoading: false,
  students: [],
  studentsPagination: null,
  studentsLoading: false,
  sessions: [],
  sessionsPagination: null,
  sessionsLoading: false,
  fees: [],
  feesPagination: null,
  feesLoading: false,
  reportSummary: null,
  reportSummaryLoading: false,
  reportStudents: [],
  reportStudentsLoading: false,
};

const adminSlice = createSlice({
  name: 'admin',
  initialState,
  reducers: {},
  extraReducers: (b) => {
    b.addCase(fetchLiveSeats.pending, (s) => {
      s.liveSeatsLoading = true;
    })
      .addCase(fetchLiveSeats.fulfilled, (s, a) => {
        s.liveSeats = a.payload;
        s.liveSeatsLoading = false;
      })
      .addCase(fetchLiveSeats.rejected, (s) => {
        s.liveSeatsLoading = false;
      })
      .addCase(fetchStudents.pending, (s) => {
        s.studentsLoading = true;
      })
      .addCase(fetchStudents.fulfilled, (s, a) => {
        s.students = a.payload.data;
        s.studentsPagination = a.payload.pagination ?? null;
        s.studentsLoading = false;
      })
      .addCase(fetchStudents.rejected, (s) => {
        s.studentsLoading = false;
      })
      .addCase(fetchSessions.pending, (s) => {
        s.sessionsLoading = true;
      })
      .addCase(fetchSessions.fulfilled, (s, a) => {
        s.sessions = a.payload.data;
        s.sessionsPagination = a.payload.pagination ?? null;
        s.sessionsLoading = false;
      })
      .addCase(fetchSessions.rejected, (s) => {
        s.sessionsLoading = false;
      })
      .addCase(fetchFees.pending, (s) => {
        s.feesLoading = true;
      })
      .addCase(fetchFees.fulfilled, (s, a) => {
        s.fees = a.payload.data;
        s.feesPagination = a.payload.pagination ?? null;
        s.feesLoading = false;
      })
      .addCase(fetchFees.rejected, (s) => {
        s.feesLoading = false;
      })
      .addCase(fetchReportSummary.pending, (s) => {
        s.reportSummaryLoading = true;
      })
      .addCase(fetchReportSummary.fulfilled, (s, a) => {
        s.reportSummary = a.payload;
        s.reportSummaryLoading = false;
      })
      .addCase(fetchReportSummary.rejected, (s) => {
        s.reportSummaryLoading = false;
      })
      .addCase(fetchReportStudents.pending, (s) => {
        s.reportStudentsLoading = true;
      })
      .addCase(fetchReportStudents.fulfilled, (s, a) => {
        s.reportStudents = a.payload;
        s.reportStudentsLoading = false;
      })
      .addCase(fetchReportStudents.rejected, (s) => {
        s.reportStudentsLoading = false;
      })
      .addCase(forceCheckoutSession.fulfilled, (s, a) => {
        s.sessions = s.sessions.map((sess) =>
          sess._id === a.payload ? { ...sess, status: 'completed' as const, checkoutType: 'forced' as const } : sess
        );
      })
      .addCase(markFeePaid.fulfilled, (s, a) => {
        s.fees = s.fees.map((fee) =>
          fee._id === a.payload ? { ...fee, status: 'paid' as const, paidAt: new Date().toISOString() } : fee
        );
      })
      .addCase(deleteStudent.fulfilled, (s, a) => {
        s.students = s.students.filter((st) => st._id !== a.payload);
      })
      .addCase(logout.fulfilled, () => initialState)
      .addCase(sessionExpired, () => initialState);
  },
});

// Selectors
export const selectLiveSeats = (s: { admin: AdminState }) => s.admin.liveSeats;
export const selectLiveSeatsLoading = (s: { admin: AdminState }) => s.admin.liveSeatsLoading;
export const selectStudents = (s: { admin: AdminState }) => s.admin.students;
export const selectStudentsPagination = (s: { admin: AdminState }) => s.admin.studentsPagination;
export const selectStudentsLoading = (s: { admin: AdminState }) => s.admin.studentsLoading;
export const selectSessions = (s: { admin: AdminState }) => s.admin.sessions;
export const selectSessionsPagination = (s: { admin: AdminState }) => s.admin.sessionsPagination;
export const selectSessionsLoading = (s: { admin: AdminState }) => s.admin.sessionsLoading;
export const selectFees = (s: { admin: AdminState }) => s.admin.fees;
export const selectFeesPagination = (s: { admin: AdminState }) => s.admin.feesPagination;
export const selectFeesLoading = (s: { admin: AdminState }) => s.admin.feesLoading;
export const selectReportSummary = (s: { admin: AdminState }) => s.admin.reportSummary;
export const selectReportSummaryLoading = (s: { admin: AdminState }) => s.admin.reportSummaryLoading;
export const selectReportStudents = (s: { admin: AdminState }) => s.admin.reportStudents;
export const selectReportStudentsLoading = (s: { admin: AdminState }) => s.admin.reportStudentsLoading;

export default adminSlice.reducer;
