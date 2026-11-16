import { Schema, model } from 'mongoose';

export interface ILoginThrottle {
  /** "phone:<digits>" or "ip:<address>". Kept for phones that do not exist, too. */
  key: string;
  count: number;
  lockedUntil: Date | null;
  /** End of the counting window (or of the lock); MongoDB deletes the record afterwards. */
  expiresAt: Date;
}

const loginThrottleSchema = new Schema<ILoginThrottle>(
  {
    key: { type: String, required: true, unique: true },
    count: { type: Number, default: 0 },
    lockedUntil: { type: Date, default: null },
    expiresAt: { type: Date, required: true },
  },
  { versionKey: false }
);

loginThrottleSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const LoginThrottle = model<ILoginThrottle>('LoginThrottle', loginThrottleSchema);
