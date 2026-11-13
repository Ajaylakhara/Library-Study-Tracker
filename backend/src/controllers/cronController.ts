import { timingSafeEqual } from 'crypto';
import { Request, Response } from 'express';
import { JobLock } from '../models/JobLock';
import { JobRun, JobRunName } from '../models/JobRun';
import { connectDB } from '../db/connectDB';
import { runShiftMonitor, ShiftMonitorResult } from '../jobs/shiftMonitor';
import { processQueuedNotifications, NotificationWorkerResult } from '../jobs/notificationWorker';

const LOCK_MS = 30_000;
const MAX_TICK_MS = 25_000;

function cronSecretMatches(req: Request): boolean {
  const expected = process.env.CRON_SECRET?.trim();
  if (!expected) return false;
  const authorization = req.get('Authorization') ?? '';
  const bearer = authorization.match(/^Bearer\s+(.+)$/i)?.[1];
  const supplied = bearer || req.get('x-cron-secret') || '';
  const expectedBytes = Buffer.from(expected);
  const suppliedBytes = Buffer.from(supplied);
  return expectedBytes.length === suppliedBytes.length && timingSafeEqual(expectedBytes, suppliedBytes);
}

async function acquireLock(name: string): Promise<Date | null> {
  await JobLock.init();
  const now = new Date();
  const lockedUntil = new Date(now.getTime() + LOCK_MS);
  const existing = await JobLock.findOneAndUpdate(
    { name, lockedUntil: { $lte: now } },
    { $set: { lockedUntil } },
    { new: true }
  );
  if (existing) return lockedUntil;

  try {
    await JobLock.create({ name, lockedUntil });
    return lockedUntil;
  } catch (error) {
    if (typeof error === 'object' && error !== null && 'code' in error && error.code === 11000) {
      return null;
    }
    throw error;
  }
}

async function runLocked<T extends { processed: number }>(
  name: JobRunName,
  task: () => Promise<T>
): Promise<{ skipped: boolean; result?: T; duration: number }> {
  const lockUntil = await acquireLock(name);
  if (!lockUntil) return { skipped: true, duration: 0 };

  const startedAt = new Date();
  const startTime = Date.now();
  try {
    await JobRun.findOneAndUpdate(
      { name },
      { $set: { startedAt, completedAt: null, processed: 0, error: null } },
      { upsert: true, new: true }
    );
    console.info(`[Cron] ${name} started.`);
    const result = await task();
    const completedAt = new Date();
    await JobRun.updateOne(
      { name },
      { $set: { completedAt, processed: result.processed, error: null } }
    );
    console.info(`[Cron] ${name} completed: processed=${result.processed}, duration=${Date.now() - startTime}ms.`);
    return { skipped: false, result, duration: Date.now() - startTime };
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
    console.error(`[Cron] ${name} failed (${error instanceof Error ? error.name : 'UnknownError'}).`);
    throw error;
  } finally {
    await JobLock.deleteOne({ name, lockedUntil: lockUntil });
  }
}

function sendUnauthorized(res: Response): void {
  res.status(401).json({ ok: false, message: 'Unauthorized cron request.' });
}

async function withCronAuth(
  req: Request,
  res: Response,
  action: () => Promise<void>
): Promise<void> {
  if (!process.env.CRON_SECRET?.trim()) {
    res.status(503).json({ ok: false, message: 'Cron execution is not configured.' });
    return;
  }
  if (!cronSecretMatches(req)) {
    sendUnauthorized(res);
    return;
  }
  const started = Date.now();
  try {
    await connectDB();
    await action();
  } catch (error) {
    console.error(`[Cron] Request failed (${error instanceof Error ? error.name : 'UnknownError'}).`);
    if (!res.headersSent) {
      res.status(500).json({
        ok: false,
        processed: 0,
        duration: Date.now() - started,
        message: 'Cron job failed.',
      });
    }
  }
}

function writeJobResponse<T extends { processed: number }>(
  res: Response,
  response: { skipped: boolean; result?: T; duration: number }
): void {
  if (response.skipped) {
    res.json({ ok: true, skipped: true, processed: 0, duration: response.duration });
    return;
  }
  res.json({
    ok: true,
    processed: response.result?.processed ?? 0,
    duration: response.duration,
    result: response.result,
  });
}

export async function runShiftMonitorCron(req: Request, res: Response): Promise<void> {
  await withCronAuth(req, res, async () => {
    const result = await runLocked('shift-monitor', runShiftMonitor);
    writeJobResponse<ShiftMonitorResult>(res, result);
  });
}

export async function runNotificationWorkerCron(req: Request, res: Response): Promise<void> {
  await withCronAuth(req, res, async () => {
    const result = await runLocked('notification-worker', () =>
      processQueuedNotifications(undefined, { maxDurationMs: MAX_TICK_MS })
    );
    writeJobResponse<NotificationWorkerResult>(res, result);
  });
}

export async function runCronTick(req: Request, res: Response): Promise<void> {
  await withCronAuth(req, res, async () => {
    const tickLock = await acquireLock('tick');
    if (!tickLock) {
      res.json({ ok: true, skipped: true, processed: 0, duration: 0 });
      return;
    }
    const started = Date.now();
    try {
      const shift = await runLocked('shift-monitor', runShiftMonitor);
      let workerProcessed = 0;
      let workerSent = 0;
      let workerErrors = 0;
      let workerPasses = 0;
      let workerSkipped = false;
      for (let pass = 0; pass < 3 && Date.now() - started < MAX_TICK_MS; pass++) {
        const remaining = Math.max(1, MAX_TICK_MS - (Date.now() - started));
        const worker = await runLocked('notification-worker', () =>
          processQueuedNotifications(undefined, { maxDurationMs: remaining })
        );
        if (worker.skipped || !worker.result) {
          workerSkipped = true;
          break;
        }
        workerPasses++;
        workerProcessed += worker.result.processed;
        workerSent += worker.result.sent;
        workerErrors += worker.result.errors;
        if (worker.result.processed === 0) break;
      }
      const duration = Date.now() - started;
      const processed = (shift.result?.processed ?? 0) + workerProcessed;
      res.json({
        ok: true,
        processed,
        duration,
        shiftMonitor: shift.skipped ? { skipped: true } : shift.result,
        notificationWorker: {
          processed: workerProcessed,
          sent: workerSent,
          errors: workerErrors,
          passes: workerPasses,
          skipped: workerSkipped,
        },
      });
    } finally {
      await JobLock.deleteOne({ name: 'tick', lockedUntil: tickLock });
    }
  });
}
