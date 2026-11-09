import type { ShiftHours, Channel } from './auth';

export interface ActiveSession {
  id: string;
  seatNumber: number;
  shiftHours: ShiftHours;
  checkInAt: string;
  shiftEndsAt: string;
  status: 'active' | 'completed';
}

export interface FreeSeat {
  number: number;
}

export interface CheckOutResult {
  sessionId: string;
  durationMinutes: number;
  durationFormatted: string;
  checkOutAt: string;
}

export interface LastStudy extends CheckOutResult {
  seatNumber: number;
  checkInAt: string;
}

export interface AttendanceItem {
  id: string;
  seatNumber: number;
  shiftHours: ShiftHours;
  checkInAt: string;
  shiftEndsAt: string;
  checkOutAt: string | null;
  durationMinutes: number | null;
  durationFormatted: string | null;
  status: 'active' | 'completed';
  checkoutType: 'manual' | 'auto' | 'forced' | null;
}

export interface MonthSummary {
  month: string;
  totalSessions: number;
  totalMinutes: number;
  totalFormatted: string;
}

export interface Fee {
  _id: string;
  month: string;
  amount: number;
  status: 'paid' | 'unpaid';
  paidAt: string | null;
}

export interface Profile {
  id: string;
  name: string;
  phone: string;
  email?: string;
  seatNumber?: number;
  shiftHours?: ShiftHours;
  whatsappOptIn: boolean;
  smsOptIn: boolean;
  preferredChannel: Channel;
  monthlyFee: number;
}
