import mongoose, { Document, Schema } from 'mongoose';

export type NotificationType =
  | 'approved'
  | 'rejected'
  | 'shift_reminder'
  | 'shift_ended'
  | 'auto_checkout'
  | 'fee_unpaid'
  | 'overtime_admin'
  | 'fee_generated_admin'
  | 'registration_pending_admin';

export type NotificationChannel = 'telegram' | 'whatsapp' | 'sms' | 'inapp';
export type NotificationStatus = 'queued' | 'sent' | 'failed' | 'manual_pending';
export type NotificationActionStatus = 'open' | 'contacted' | 'resolved';
export type NotificationContactMethod = 'whatsapp' | 'sms' | 'call';

export interface INotification extends Document {
  _id: mongoose.Types.ObjectId;
  user: mongoose.Types.ObjectId;
  type: NotificationType;
  vars: Record<string, string | number>;
  message: string;
  channel: NotificationChannel;
  status: NotificationStatus;
  attempts: number;
  lastError: string | null;
  providerMessageId: string | null;
  sentAt: Date | null;
  sessionId: mongoose.Types.ObjectId | null;
  feeId: mongoose.Types.ObjectId | null;
  read: boolean;
  readAt: Date | null;
  studentNameSnapshot: string | null;
  studentPhoneSnapshot: string | null;
  actionStatus: NotificationActionStatus | null;
  contactedAt: Date | null;
  contactMethod: NotificationContactMethod | null;
  contactedBy: mongoose.Types.ObjectId | null;
  resolvedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const notificationSchema = new Schema<INotification>(
  {
    user: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      required: true,
    },
    type: {
      type: String,
      enum: [
        'approved',
        'rejected',
        'shift_reminder',
        'shift_ended',
        'auto_checkout',
        'fee_unpaid',
        'overtime_admin',
        'fee_generated_admin',
        'registration_pending_admin',
      ],
      required: true,
    },
    vars: {
      type: Map,
      of: Schema.Types.Mixed,
      default: {},
    },
    channel: {
      type: String,
      enum: ['telegram', 'whatsapp', 'sms', 'inapp'],
      required: true,
    },
    message: { type: String, required: true, default: '' },
    status: {
      type: String,
      enum: ['queued', 'sent', 'failed', 'manual_pending'],
      default: 'queued',
    },
    attempts: { type: Number, default: 0 },
    lastError: { type: String, default: null },
    providerMessageId: { type: String, default: null },
    sentAt: { type: Date, default: null },
    sessionId: {
      type: Schema.Types.ObjectId,
      ref: 'Session',
      default: null,
    },
    feeId: {
      type: Schema.Types.ObjectId,
      ref: 'Fee',
      default: null,
    },
    read: { type: Boolean, default: false },
    readAt: { type: Date, default: null },
    studentNameSnapshot: { type: String, default: null },
    studentPhoneSnapshot: { type: String, default: null },
    actionStatus: {
      type: String,
      enum: ['open', 'contacted', 'resolved'],
      default: null,
    },
    contactedAt: { type: Date, default: null },
    contactMethod: {
      type: String,
      enum: ['whatsapp', 'sms', 'call'],
      default: null,
    },
    contactedBy: {
      type: Schema.Types.ObjectId,
      ref: 'User',
      default: null,
    },
    resolvedAt: { type: Date, default: null },
  },
  { timestamps: true }
);

// Unique partial index: same alert never created twice for a session
notificationSchema.index(
  { sessionId: 1, type: 1, user: 1, channel: 1 },
  {
    unique: true,
    partialFilterExpression: { sessionId: { $type: 'objectId' } },
    name: 'unique_session_notification_recipient',
  }
);
notificationSchema.index({ status: 1, attempts: 1 });
notificationSchema.index({ user: 1, read: 1 });
notificationSchema.index({ read: 1, status: 1, type: 1 });
notificationSchema.index({ type: 1, actionStatus: 1 });

export const Notification = mongoose.model<INotification>('Notification', notificationSchema);
