import { NextFunction, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { JobRun } from '../models/JobRun';
import { Notification } from '../models/Notification';
import { User } from '../models/User';
import { config } from '../config';
import { RETRY_WINDOW_MS } from '../jobs/notificationWorker';
import { logEvent } from '../utils/logger';

function retryableFailedFilter(now: Date): Record<string, unknown> {
  return {
    status: 'failed',
    channel: 'telegram',
    updatedAt: { $gte: new Date(now.getTime() - RETRY_WINDOW_MS) },
  };
}

export async function getJobsStatus(
  _req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const now = new Date();
    const [runs, failedNotificationCount, retryableFailedCount, adminTelegramLinked] = await Promise.all([
      JobRun.find({
        name: { $in: ['shift-monitor', 'notification-worker', 'tick'] },
      }).lean(),
      Notification.countDocuments({ status: 'failed' }),
      Notification.countDocuments(retryableFailedFilter(now)),
      User.exists({
        role: 'admin',
        status: 'approved',
        isDeleted: false,
        telegramChatId: { $type: 'string' },
      }),
    ]);
    const byName = new Map(runs.map((run) => [run.name, run]));
    const format = (name: 'shift-monitor' | 'notification-worker') => {
      const run = byName.get(name);
      return {
        lastRunAt: run?.completedAt ?? run?.startedAt ?? null,
        startedAt: run?.startedAt ?? null,
        completedAt: run?.completedAt ?? null,
        processed: run?.processed ?? 0,
        error: run?.error ?? null,
      };
    };
    const tick = byName.get('tick');
    res.json({
      success: true,
      data: {
        schedulerMode: process.env.VERCEL
          ? 'external'
          : config.runJobsInProcess
            ? 'in-process'
            : 'disabled',
        cronConfigured: Boolean(process.env.CRON_SECRET?.trim()),
        shiftMonitor: format('shift-monitor'),
        notificationWorker: format('notification-worker'),
        lastCronRunAt: tick?.completedAt ?? tick?.startedAt ?? null,
        lastCronResult: tick?.result ?? null,
        lastCronError: tick?.error ?? null,
        failedNotificationCount,
        retryableFailedCount,
        adminTelegramLinked: Boolean(adminTelegramLinked),
      },
    });
  } catch (error) {
    next(error);
  }
}

/**
 * Admin action: put failed Telegram notifications from the last 24 hours back in the
 * queue. The next cron tick delivers them (with the normal backoff and logging).
 */
export async function retryFailedNotifications(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const outcome = await Notification.updateMany(retryableFailedFilter(new Date()), {
      $set: {
        status: 'queued',
        attempts: 0,
        nextAttemptAt: null,
        permanentFailure: false,
      },
    });
    logEvent('info', 'failed_notifications_requeued', {
      requeued: outcome.modifiedCount,
      adminId: req.user ? String(req.user._id) : undefined,
    });
    res.json({
      success: true,
      message:
        outcome.modifiedCount > 0
          ? `${outcome.modifiedCount} failed notification(s) queued for retry.`
          : 'No failed Telegram notifications from the last 24 hours to retry.',
      data: { requeued: outcome.modifiedCount },
    });
  } catch (error) {
    next(error);
  }
}
