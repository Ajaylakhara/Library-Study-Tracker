import { Schema, model } from 'mongoose';

export type JobRunName = 'shift-monitor' | 'notification-worker' | 'tick';

export interface IJobRun {
  name: JobRunName;
  startedAt: Date;
  completedAt: Date | null;
  processed: number;
  error: string | null;
  /** Summary of the last combined cron tick (only used by the 'tick' record). */
  result?: Record<string, unknown> | null;
}

const jobRunSchema = new Schema<IJobRun>(
  {
    name: { type: String, enum: ['shift-monitor', 'notification-worker', 'tick'], required: true, unique: true },
    startedAt: { type: Date, required: true },
    completedAt: { type: Date, default: null },
    processed: { type: Number, default: 0 },
    error: { type: String, default: null },
    result: { type: Schema.Types.Mixed, default: null },
  },
  { versionKey: false }
);

export const JobRun = model<IJobRun>('JobRun', jobRunSchema);
