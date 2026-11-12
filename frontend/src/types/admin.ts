import type { UserStatus, ShiftHours, Channel } from './auth';

export interface Pagination {
  page: number;
  limit: number;
  total: number;
  pages: number;
}

export interface AdminTelegramStatus {
  connected: boolean;
  linkedAt: string | null;
}

export interface AdminTelegramLink {
  link: string;
  expiresAt: string;
}

export interface LiveSeat {
  seatId: string | null;
  seatNumber: number;
  isActive: boolean;
  isOccupied: boolean;
  status: 'occupied' | 'overtime' | 'free' | 'inactive';
  session: {
    sessionId: string;
    student: { _id: string; name: string; phone: string };
    shiftHours: ShiftHours;
    checkInAt: string;
    shiftEndsAt: string;
  } | null;
}

export interface Student {
  _id: string;
  name: string;
  phone: string;
  email?: string;
  seatNumber?: number;
  shiftHours?: ShiftHours;
  status: UserStatus;
  monthlyFee: number;
  whatsappOptIn: boolean;
  smsOptIn: boolean;
  preferredChannel: Channel;
  isDeleted?: boolean;
  deletedAt?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface AdminSession {
  _id: string;
  student: { _id: string; name: string; phone: string } | null;
  seat: { _id: string; number: number } | null;
  shiftHours: ShiftHours;
  checkInAt: string;
  shiftEndsAt: string;
  checkOutAt: string | null;
  durationMinutes: number | null;
  durationFormatted: string | null;
  status: 'active' | 'completed';
  checkoutType: 'manual' | 'auto' | 'forced' | null;
}

export interface AdminFee {
  _id: string;
  student: { _id: string; name: string; phone: string } | null;
  month: string;
  amount: number;
  status: 'paid' | 'unpaid';
  paidAt: string | null;
  note?: string;
  lastReminderAt?: string | null;
  lastReminderChannel?: 'whatsapp' | 'sms' | 'telegram' | null;
  reminderCount?: number;
}

export type FeeReminderChannel = 'whatsapp' | 'sms' | 'telegram';

export interface PreparedFeeReminder {
  feeId: string;
  studentId: string;
  studentName: string;
  phone: string;
  month: string;
  amount: number;
  totalDue: number;
  message: string;
  channels: FeeReminderChannel[];
  preferredChannel: FeeReminderChannel;
  lastReminder: { sentAt: string; channel: FeeReminderChannel } | null;
}

export interface SentFeeReminder {
  notificationId?: string;
  channel: FeeReminderChannel;
  message: string;
  url?: string;
  smsUri?: string;
  confirmationRequired?: boolean;
  lastReminder?: { sentAt: string; channel: FeeReminderChannel } | null;
  telegramSent?: boolean;
}

export interface ReportSummary {
  period: { from: string; to: string };
  totalSessions: number;
  totalMinutes: number;
  totalFormatted: string;
  unpaidFees: number;
  unpaidFeeAmount: number;
  collectedRevenue: number;
  daily: { date: string; checkIns: number; checkOuts: number }[];
  hourly: { hour: number; averageOccupancy: number }[];
}

export interface StudentReportRow {
  student?: { _id: string; name: string; phone: string };
  totalMinutes: number;
  totalFormatted: string;
  totalSessions: number;
}

export interface AppNotification {
  _id: string;
  user: { _id: string; name: string; phone: string } | null;
  type: string;
  channel: 'whatsapp' | 'sms' | 'inapp';
  status: 'queued' | 'sent' | 'failed';
  attempts: number;
  lastError: string | null;
  read?: boolean;
  readAt?: string | null;
  studentNameSnapshot?: string | null;
  studentPhoneSnapshot?: string | null;
  updatedAt: string;
  createdAt: string;
}

/*
 * Temporarily disabled with admin overtime follow-up alerts.
 *
export type ContactMethod = 'whatsapp' | 'sms' | 'call';

export interface NeedsActionNotification {
  _id: string;
  studentName: string;
  phone: string | null;
  seatNumber: number | null;
  minutesOver: number | null;
  createdAt: string;
}
*/
