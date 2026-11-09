export type Role = 'student' | 'admin';
export type UserStatus = 'pending' | 'approved' | 'rejected' | 'blocked';
export type ShiftHours = 4 | 12 | 24;
export type Channel = 'whatsapp' | 'sms';

export interface AuthUser {
  id: string;
  name: string;
  phone: string;
  email?: string;
  role: Role;
  status: UserStatus;
  seatNumber?: number;
  shiftHours?: ShiftHours;
  monthlyFee?: number;
  whatsappOptIn?: boolean;
  smsOptIn?: boolean;
  preferredChannel?: Channel;
  isDeleted?: boolean;
  deletedAt?: string | null;
}

export interface LoginInput {
  phone: string;
  pin: string;
}

export interface RegisterInput {
  name: string;
  phone: string;
  pin: string;
  seatNumber: number;
  shiftHours: ShiftHours;
  whatsappOptIn?: boolean;
  smsOptIn?: boolean;
}
