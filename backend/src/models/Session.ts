import mongoose, { Document, Schema } from 'mongoose';

export type ShiftHours = 4 | 12 | 24;
export type SessionStatus = 'active' | 'completed';
export type CheckoutType = 'manual' | 'auto' | 'forced';

export interface ISession extends Document {
  _id: mongoose.Types.ObjectId;
  student: mongoose.Types.ObjectId;
  seat: mongoose.Types.ObjectId;
  shiftHours: ShiftHours;
  checkInAt: Date;
  shiftEndsAt: Date;
  checkOutAt: Date | null;
  durationMinutes: number | null;
  status: SessionStatus;
  checkoutType: CheckoutType | null;
  alertsSent: {
    shiftReminder: boolean;
    shiftEnd: boolean;
    overtime: boolean;
    autoCheckout: boolean;
  };
  overtimeAdminAlertedAt: Date | null;
  overtimeSnoozedUntil: Date | null;
  overtimeSnoozeAlertPending: boolean;
  overtimeRepeatCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const sessionSchema = new Schema<ISession>(
  {
    student: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    seat: {
      type: Schema.Types.ObjectId,
      ref: 'Seat',
      required: true,
    },
    shiftHours: {
      type: Number,
      enum: [4, 12, 24],
      required: true,
    },
    checkInAt: { type: Date, required: true },
    shiftEndsAt: { type: Date, required: true },
    checkOutAt: { type: Date, default: null },
    durationMinutes: { type: Number, default: null },
    status: {
      type: String,
      enum: ['active', 'completed'],
      default: 'active',
    },
    checkoutType: {
      type: String,
      enum: ['manual', 'auto', 'forced'],
      default: null,
    },
    alertsSent: {
      shiftReminder: { type: Boolean, default: false },
      shiftEnd: { type: Boolean, default: false },
      overtime: { type: Boolean, default: false },
      autoCheckout: { type: Boolean, default: false },
    },
    overtimeAdminAlertedAt: { type: Date, default: null },
    overtimeSnoozedUntil: { type: Date, default: null },
    overtimeSnoozeAlertPending: { type: Boolean, default: false },
    overtimeRepeatCount: { type: Number, default: 0, min: 0, max: 6 },
  },
  { timestamps: true }
);

// Partial unique indexes: enforce DB-level constraints (not just code)
// One active session per seat
sessionSchema.index(
  { seat: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'active' },
    name: 'unique_active_seat',
  }
);
// One active session per student
sessionSchema.index(
  { student: 1 },
  {
    unique: true,
    partialFilterExpression: { status: 'active' },
    name: 'unique_active_student',
  }
);
// Fast queries by student + status
sessionSchema.index({ student: 1, status: 1 });
sessionSchema.index({ status: 1, shiftEndsAt: 1 });

export const Session = mongoose.model<ISession>('Session', sessionSchema);
