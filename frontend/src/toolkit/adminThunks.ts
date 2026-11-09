import { createAppThunk, errMsg } from './createAppThunk';
import { get, post, patch, del, downloadFile } from '../store/api';
import { ENDPOINTS } from '../config/endpoints';
import type {
  LiveSeat,
  Student,
  AdminSession,
  AdminFee,
  ReportSummary,
  StudentReportRow,
  AppNotification,
  AttendanceItem,
} from '../types';
import { showToast } from './toastSlice';

export const fetchLiveSeats = createAppThunk('admin/fetchLiveSeats', async (_, { rejectWithValue }) => {
  try {
    const res = await get<LiveSeat[]>(ENDPOINTS.admin.liveSeats);
    return res.data;
  } catch (e) {
    return rejectWithValue(errMsg(e));
  }
});

export const fetchStudents = createAppThunk(
  'admin/fetchStudents',
  async (query: { search?: string; status?: string; page?: number; limit?: number } | undefined, { rejectWithValue }) => {
    try {
      const res = await get<Student[]>(ENDPOINTS.admin.students, query as Record<string, string | number | undefined>);
      return { data: res.data, pagination: res.pagination };
    } catch (e) {
      return rejectWithValue(errMsg(e));
    }
  }
);

export const editStudent = createAppThunk(
  'admin/editStudent',
  async (
    { id, body }: { id: string; body: { name?: string; phone?: string; email?: string; seatNumber?: number; shiftHours?: number; monthlyFee?: number } },
    { dispatch, rejectWithValue }
  ) => {
    try {
      const res = await patch<Student>(ENDPOINTS.admin.studentById(id), body as Record<string, unknown>);
      dispatch(showToast('success', 'Student details updated'));
      return res.data;
    } catch (e) {
      dispatch(showToast('error', errMsg(e)));
      return rejectWithValue(errMsg(e));
    }
  }
);

export const updateStudentStatus = createAppThunk(
  'admin/updateStudentStatus',
  async (
    { id, status }: { id: string; status: 'approved' | 'rejected' | 'blocked' },
    { dispatch, rejectWithValue }
  ) => {
    try {
      const res = await patch<{ message: string }>(ENDPOINTS.admin.updateStudentStatus(id), { status });
      dispatch(showToast('success', res.message || `Student status updated to ${status}`));
      return { id, status };
    } catch (e) {
      dispatch(showToast('error', errMsg(e)));
      return rejectWithValue(errMsg(e));
    }
  }
);

export const resetStudentPin = createAppThunk(
  'admin/resetStudentPin',
  async (id: string, { dispatch, rejectWithValue }) => {
    try {
      const res = await post<{ message: string; pin: string }>(ENDPOINTS.admin.resetStudentPin(id));
      dispatch(showToast('success', res.data.message || 'PIN has been reset'));
      return { id, ...res.data };
    } catch (e) {
      dispatch(showToast('error', errMsg(e)));
      return rejectWithValue(errMsg(e));
    }
  }
);

export const deleteStudent = createAppThunk(
  'admin/deleteStudent',
  async (id: string, { dispatch, rejectWithValue }) => {
    try {
      const res = await del<{ message: string }>(ENDPOINTS.admin.studentById(id));
      dispatch(showToast('success', res.message || 'Student deleted successfully'));
      return id;
    } catch (e) {
      dispatch(showToast('error', errMsg(e)));
      return rejectWithValue(errMsg(e));
    }
  }
);

export const fetchSessions = createAppThunk(
  'admin/fetchSessions',
  async (
    query: { studentId?: string; status?: string; page?: number; limit?: number; from?: string; to?: string } | undefined,
    { rejectWithValue }
  ) => {
    try {
      const res = await get<AdminSession[]>(ENDPOINTS.admin.sessions, query as Record<string, string | number | undefined>);
      return { data: res.data, pagination: res.pagination };
    } catch (e) {
      return rejectWithValue(errMsg(e));
    }
  }
);

export const forceCheckoutSession = createAppThunk(
  'admin/forceCheckoutSession',
  async (sessionId: string, { dispatch, rejectWithValue }) => {
    try {
      const res = await post<{ message: string }>(ENDPOINTS.admin.forceCheckout(sessionId));
      dispatch(showToast('success', res.message || 'Session ended by admin'));
      return sessionId;
    } catch (e) {
      dispatch(showToast('error', errMsg(e)));
      return rejectWithValue(errMsg(e));
    }
  }
);

export const fetchFees = createAppThunk(
  'admin/fetchFees',
  async (
    query: { month?: string; status?: string; page?: number; limit?: number } | undefined,
    { rejectWithValue }
  ) => {
    try {
      const res = await get<AdminFee[]>(ENDPOINTS.admin.fees, query as Record<string, string | number | undefined>);
      return { data: res.data, pagination: res.pagination };
    } catch (e) {
      return rejectWithValue(errMsg(e));
    }
  }
);

export const markFeePaid = createAppThunk(
  'admin/markFeePaid',
  async ({ feeId, note }: { feeId: string; note?: string }, { dispatch, rejectWithValue }) => {
    try {
      const res = await patch<{ message: string }>(ENDPOINTS.admin.markFeePaid(feeId), note ? { note } : {});
      dispatch(showToast('success', res.message || 'Fee marked as paid'));
      return feeId;
    } catch (e) {
      dispatch(showToast('error', errMsg(e)));
      return rejectWithValue(errMsg(e));
    }
  }
);

export const generateFees = createAppThunk(
  'admin/generateFees',
  async (month: string, { dispatch, rejectWithValue }) => {
    try {
      const res = await post<{ generated: number; message: string }>(ENDPOINTS.admin.generateFees, { month });
      dispatch(showToast('success', res.message || `Fees generated for ${month}`));
      return res.data;
    } catch (e) {
      dispatch(showToast('error', errMsg(e)));
      return rejectWithValue(errMsg(e));
    }
  }
);

export const fetchReportSummary = createAppThunk(
  'admin/fetchReportSummary',
  async (query: { from?: string; to?: string } | undefined, { rejectWithValue }) => {
    try {
      const res = await get<ReportSummary>(ENDPOINTS.admin.reportSummary, query);
      return res.data;
    } catch (e) {
      return rejectWithValue(errMsg(e));
    }
  }
);

export const fetchReportStudents = createAppThunk(
  'admin/fetchReportStudents',
  async (month: string, { rejectWithValue }) => {
    try {
      const res = await get<StudentReportRow[]>(ENDPOINTS.admin.reportStudents, { month });
      return res.data;
    } catch (e) {
      return rejectWithValue(errMsg(e));
    }
  }
);

export const exportAttendanceCsv = createAppThunk(
  'admin/exportAttendanceCsv',
  async (month: string, { dispatch, rejectWithValue }) => {
    try {
      await downloadFile(ENDPOINTS.admin.exportAttendanceCsv, `attendance-${month}.csv`, { month });
      dispatch(showToast('success', 'Attendance CSV downloaded'));
      return true;
    } catch (e) {
      dispatch(showToast('error', errMsg(e)));
      return rejectWithValue(errMsg(e));
    }
  }
);

export const fetchNotifications = createAppThunk(
  'admin/fetchNotifications',
  async (query: { page?: number; limit?: number } | undefined, { rejectWithValue }) => {
    try {
      const res = await get<AppNotification[]>(ENDPOINTS.admin.notifications, query);
      return { data: res.data, pagination: res.pagination };
    } catch (e) {
      return rejectWithValue(errMsg(e));
    }
  }
);

export const fetchStudentAttendance = createAppThunk(
  'admin/fetchStudentAttendance',
  async ({ id, month }: { id: string; month?: string }, { rejectWithValue }) => {
    try {
      const res = await get<AttendanceItem[]>(ENDPOINTS.admin.studentAttendance(id), month ? { month } : undefined);
      return res.data;
    } catch (e) {
      return rejectWithValue(errMsg(e));
    }
  }
);
