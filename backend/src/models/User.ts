import mongoose, { Document, Schema, Model } from 'mongoose';
import bcrypt from 'bcryptjs';

export type UserRole = 'admin' | 'student';
export type UserStatus = 'pending' | 'approved' | 'rejected' | 'blocked';
export type ShiftHours = 4 | 12 | 24;

export interface IUser extends Document {
  _id: mongoose.Types.ObjectId;
  name: string;
  phone?: string;
  email?: string;
  seatNumber?: number;
  shiftHours?: ShiftHours;
  pinHash?: string;
  passwordHash?: string;
  role: UserRole;
  status: UserStatus;
  monthlyFee: number;
  whatsappOptIn: boolean;
  smsOptIn: boolean;
  preferredChannel: 'whatsapp' | 'sms' | 'telegram';
  telegramChatId?: string;
  telegramLinkedAt?: Date;
  telegramLinkCodeHash?: string;
  telegramLinkExpires?: Date;
  failedAttempts: number;
  lockedUntil: Date | null;
  tokenVersion: number;
  isDeleted: boolean;
  deletedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
  // methods
  comparePin(pin: string): Promise<boolean>;
  comparePassword(password: string): Promise<boolean>;
}

export interface IUserModel extends Model<IUser> {
  findByPhone(phone: string): Promise<IUser | null>;
  findByEmail(email: string): Promise<IUser | null>;
}

const userSchema = new Schema<IUser>(
  {
    name: {
      type: String,
      required: true,
      trim: true,
      maxlength: 100,
    },
    phone: {
      type: String,
      required: function (this: IUser) {
        return this.role === 'student' || this.role === 'admin';
      },
      trim: true,
      match: [/^\d{10}$/, 'Phone must be a 10-digit Indian mobile number'],
    },
    email: {
      type: String,
      trim: true,
      lowercase: true,
      match: [/^\S+@\S+\.\S+$/, 'Please provide a valid email address'],
      required: false,
    },
    seatNumber: {
      type: Number,
      min: 1,
      max: 70,
    },
    shiftHours: {
      type: Number,
      enum: [4, 12, 24],
    },
    pinHash: {
      type: String,
      required: true,
      select: false, // never return pinHash by default
    },
    passwordHash: {
      type: String,
      select: false, // never return passwordHash by default
    },
    role: {
      type: String,
      enum: ['admin', 'student'],
      default: 'student',
    },
    status: {
      type: String,
      enum: ['pending', 'approved', 'rejected', 'blocked'],
      default: 'pending',
    },
    monthlyFee: {
      type: Number,
      default: 0,
      min: 0,
    },
    whatsappOptIn: { type: Boolean, default: true },
    smsOptIn: { type: Boolean, default: true },
    preferredChannel: {
      type: String,
      enum: ['whatsapp', 'sms', 'telegram'],
      default: 'whatsapp',
    },
    telegramChatId: { type: String, select: false },
    telegramLinkedAt: { type: Date },
    telegramLinkCodeHash: { type: String, select: false },
    telegramLinkExpires: { type: Date, select: false },
    failedAttempts: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
    tokenVersion: { type: Number, default: 0, select: false },
    isDeleted: { type: Boolean, default: false },
    deletedAt: { type: Date, default: null },
  },
  {
    timestamps: true,
    toJSON: {
      transform(_, ret: Record<string, unknown>) {
        delete ret['passwordHash'];
        delete ret['pinHash'];
        delete ret['__v'];
        return ret;
      },
    },
  }
);

// Indexes
userSchema.index({ role: 1, status: 1 });
// Phone unique ONLY for active students (allows re-registration of soft-deleted students)
userSchema.index(
  { phone: 1 },
  { unique: true, partialFilterExpression: { isDeleted: false, role: 'student' } }
);
userSchema.index(
  { phone: 1 },
  { unique: true, partialFilterExpression: { role: 'admin' }, name: 'unique_admin_phone' }
);
// Email unique ONLY for admins
userSchema.index(
  { email: 1 },
  { unique: true, partialFilterExpression: { role: 'admin' } }
);
userSchema.index(
  { role: 1, telegramChatId: 1 },
  {
    unique: true,
    partialFilterExpression: { telegramChatId: { $type: 'string' } },
    name: 'unique_role_telegram_chat',
  }
);

// Method: compare PIN
userSchema.methods.comparePin = async function (pin: string): Promise<boolean> {
  if (!this.pinHash) return false;
  return bcrypt.compare(pin, this.pinHash);
};

// Method: compare password (for admin)
userSchema.methods.comparePassword = async function (password: string): Promise<boolean> {
  if (!this.passwordHash) return false;
  return bcrypt.compare(password, this.passwordHash);
};

// Static: find by phone (only active, non-deleted users)
userSchema.statics.findByPhone = function (phone: string) {
  return this.findOne({ phone, isDeleted: false }).select('+pinHash +passwordHash +tokenVersion');
};

// Static: find by email (for admin)
userSchema.statics.findByEmail = function (email: string) {
  return this.findOne({ email: email.toLowerCase().trim(), isDeleted: false }).select('+passwordHash +pinHash');
};

export const User = mongoose.model<IUser, IUserModel>('User', userSchema);
