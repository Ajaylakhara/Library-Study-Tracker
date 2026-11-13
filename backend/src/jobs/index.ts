import cron from 'node-cron';
import mongoose from 'mongoose';
import { runShiftMonitor } from './shiftMonitor';
import { generateMonthlyFees } from './monthlyFees';
import { processQueuedNotifications } from './notificationWorker';
import { config } from '../config';
import { JobRun, JobRunName } from '../models/JobRun';

let isShiftMonitorRunning = false;
let isNotificationWorkerRunning = false;

export function isMongoUnavailableError(err: unknown): boolean {
  const maybeName = typeof err === 'object' && err !== null && 'name' in err ? String((err as { name?: unknown }).name) : '';
  const maybeMessage = typeof err === 'object' && err !== null && 'message' in err ? String((err as { message?: unknown }).message) : err instanceof Error ? err.message : String(err);
  const text = `${maybeName}: ${maybeMessage}`;

  return /MongoServerSelectionError|MongoNetworkError|MongoTimeoutError|MongoNotConnectedError|ReplicaSetNoPrimary|server selection timed out|Could not connect to any servers|ENOTFOUND|ECONNREFUSED|ECONNRESET|ENETUNREACH|Topology closed/i.test(text);
}

async function safeCronTask(label: string, task: () => Promise<void>): Promise<void> {
  if (mongoose.connection.readyState !== 1) {
    console.warn(`[Jobs] ${label} skipped because MongoDB connection is not ready.`);
    return;
  }

  try {
    await task();
  } catch (err) {
    if (isMongoUnavailableError(err)) {
      console.warn(`[Jobs] ${label} skipped: MongoDB is unavailable. Will retry on the next scheduled run.`);
      return;
    }
    console.error(`[Jobs] ${label} failed (${err instanceof Error ? err.name : 'UnknownError'}).`);
  }
}

async function trackJob(name: JobRunName, task: () => Promise<{ processed: number }>): Promise<void> {
  const startedAt = new Date();
  await JobRun.findOneAndUpdate(
    { name },
    { $set: { startedAt, completedAt: null, processed: 0, error: null } },
    { upsert: true, new: true }
  );
  try {
    const result = await task();
    await JobRun.updateOne(
      { name },
      { $set: { completedAt: new Date(), processed: result.processed, error: null } }
    );
  } catch (error) {
    await JobRun.updateOne(
      { name },
      {
        $set: {
          completedAt: new Date(),
          error: error instanceof Error ? error.name : 'Unknown job error',
        },
      }
    );
    throw error;
  }
}

export function startJobs(): void {
  if (process.env.VERCEL || !config.runJobsInProcess) {
    console.info('[Jobs] In-process jobs disabled for this runtime.');
    return;
  }

  // Every 1 minute: shift monitor
  cron.schedule('* * * * *', async () => {
    if (isShiftMonitorRunning) return; // prevent overlap
    isShiftMonitorRunning = true;
    try {
      await safeCronTask('Shift monitor', async () => {
        await trackJob('shift-monitor', runShiftMonitor);
      });
    } finally {
      isShiftMonitorRunning = false;
    }
  });

  // Every 30 seconds: notification worker
  cron.schedule('*/30 * * * * *', async () => {
    if (isNotificationWorkerRunning) return;
    isNotificationWorkerRunning = true;
    try {
      await safeCronTask('Notification worker', async () => {
        await trackJob('notification-worker', processQueuedNotifications);
      });
    } finally {
      isNotificationWorkerRunning = false;
    }
  });

  // Monthly fee job: 00:01 IST on the first day of each month.
  cron.schedule(
    '1 0 1 * *',
    async () => {
      await safeCronTask('Monthly fee job', async () => {
        await generateMonthlyFees();
      });
    },
    { timezone: 'Asia/Kolkata' }
  );

  console.log('[Jobs] All background jobs started.');
}
