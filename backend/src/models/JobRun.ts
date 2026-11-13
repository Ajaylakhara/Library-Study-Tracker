import { Schema, model } from 'mongoose';

export type JobRunName = 'shift-monitor' | 'notification-worker';

export interface IJobRun {
  name: JobRunName;
  startedAt: Date;
  completedAt: Date | null;
  processed: number;
  error: string | null;
}

const jobRunSchema = new Schema<IJobRun>(
  {
    name: { type: String, enum: ['shift-monitor', 'notification-worker'], required: true, unique: true },
    startedAt: { type: Date, required: true },
    completedAt: { type: Date, default: null },
    processed: { type: Number, default: 0 },
    error: { type: String, default: null },
  },
  { versionKey: false }
);

export const JobRun = model<IJobRun>('JobRun', jobRunSchema);
