import { NextFunction, Response } from 'express';
import { AuthRequest } from '../middleware/auth';
import { JobRun } from '../models/JobRun';
import { config } from '../config';

export async function getJobsStatus(
  _req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const runs = await JobRun.find({
      name: { $in: ['shift-monitor', 'notification-worker'] },
    }).lean();
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
      },
    });
  } catch (error) {
    next(error);
  }
}
