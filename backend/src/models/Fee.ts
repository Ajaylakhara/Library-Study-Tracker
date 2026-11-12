import mongoose, { Document, Schema } from 'mongoose';

export type FeeStatus = 'unpaid' | 'paid';

export interface IFee extends Document {
  _id: mongoose.Types.ObjectId;
  student: mongoose.Types.ObjectId;
  month: string; // "YYYY-MM"
  amount: number;
  status: FeeStatus;
  note: string | null;
  paidAt: Date | null;
  markedBy: mongoose.Types.ObjectId | null;
  lastReminderAt: Date | null;
  lastReminderChannel: 'whatsapp' | 'sms' | 'telegram' | null;
  reminderCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const feeSchema = new Schema<IFee>(
  {
    student: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    month: {
      type: String,
      required: true,
      match: [/^\d{4}-\d{2}$/, 'Month must be in YYYY-MM format'],
    },
    amount: {
      type: Number,
      required: true,
      min: 0,
    },
    status: {
      type: String,
      enum: ['unpaid', 'paid'],
      default: 'unpaid',
    },
    note: {
      type: String,
      trim: true,
      maxlength: 500,
      default: null,
    },
    paidAt: { type: Date, default: null },
    markedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    lastReminderAt: { type: Date, default: null },
    lastReminderChannel: {
      type: String,
      enum: ['whatsapp', 'sms', 'telegram'],
      default: null,
    },
    reminderCount: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true }
);

// Unique fee per student per month (DB enforced)
feeSchema.index({ student: 1, month: 1 }, { unique: true });
feeSchema.index({ status: 1, month: 1 });

export const Fee = mongoose.model<IFee>('Fee', feeSchema);
