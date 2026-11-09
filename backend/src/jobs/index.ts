import cron from 'node-cron';
import mongoose from 'mongoose';
import { runShiftMonitor } from './shiftMonitor';
import { generateMonthlyFees } from './monthlyFees';
import { processQueuedNotifications } from './notificationWorker';

let isShiftMonitorRunning = false;
let isNotificationWorkerRunning = false;

export function isMongoUnavailableError(err: unknown): boolean {
  const maybeName = typeof err === 'object' && err !== null && 'name' in err ? String((err as { name?: unknown }).name) : '';
  const maybeMessage = typeof err === 'object' && err !== null && 'message' in err ? String((err as { message?: unknown }).message) : err instanceof Error ? err.message : String(err);
  const text = `${maybeName}: ${maybeMessage}`;

  return /MongoServerSelectionError|MongoNetworkError|MongoTimeoutError|MongoNotConnectedError|ReplicaSetNoPrimary|server selection timed out|Could not connect to any servers|ENOTFOUND|ECONNREFUSED|ECONNRESET|ENETUNREACH|Topology closed/i.test(text);
}

function safeCronTask(label: string, task: () => Promise<void>): void {
  if (mongoose.connection.readyState !== 1) {
    console.warn(`[Jobs] ${label} skipped because MongoDB connection is not ready.`);
    return;
  }

  task().catch((err) => {
    if (isMongoUnavailableError(err)) {
      console.warn(`[Jobs] ${label} skipped: MongoDB is unavailable. Will retry on the next scheduled run.`);
      return;
    }
    console.error(`[Jobs] ${label} error:`, err);
  });
}

export function startJobs(): void {
  // Every 1 minute: shift monitor
  cron.schedule('* * * * *', async () => {
    if (isShiftMonitorRunning) return; // prevent overlap
    isShiftMonitorRunning = true;
    safeCronTask('Shift monitor', async () => {
      await runShiftMonitor();
    });
    isShiftMonitorRunning = false;
  });

  // Every 30 seconds: notification worker
  cron.schedule('*/30 * * * * *', async () => {
    if (isNotificationWorkerRunning) return;
    isNotificationWorkerRunning = true;
    safeCronTask('Notification worker', async () => {
      await processQueuedNotifications();
    });
    isNotificationWorkerRunning = false;
  });

  // Monthly fee job: 00:01 IST on the 1st of every month (bills the month that just ended).
  // node-cron has no 'L' (last day) token, so schedule on the 1st in the IST timezone.
  cron.schedule(
    '1 0 1 * *',
    async () => {
      safeCronTask('Monthly fee job', async () => {
        await generateMonthlyFees();
      });
    },
    { timezone: 'Asia/Kolkata' }
  );

  console.log('[Jobs] All background jobs started.');
}
