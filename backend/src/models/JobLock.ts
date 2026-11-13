import { Schema, model } from 'mongoose';

export interface IJobLock {
  name: string;
  lockedUntil: Date;
}

const jobLockSchema = new Schema<IJobLock>(
  {
    name: { type: String, required: true, unique: true },
    lockedUntil: { type: Date, required: true },
  },
  { versionKey: false }
);

jobLockSchema.index({ lockedUntil: 1 }, { expireAfterSeconds: 0 });

export const JobLock = model<IJobLock>('JobLock', jobLockSchema);
