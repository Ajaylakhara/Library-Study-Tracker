import { Response, NextFunction } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';
import {
  getSmsAction,
  markSent,
  prepareReminder,
  ReminderChannel,
  sendReminder,
} from '../services/feeReminderService';

const reminderChannel = z.enum(['whatsapp', 'sms', 'telegram']);

export async function prepareFeeReminder(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const channel = req.body?.channel === undefined
      ? undefined
      : reminderChannel.parse(req.body.channel) as ReminderChannel;
    const data = await prepareReminder({ feeId: String(req.params.feeId) }, channel);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

export async function sendFeeReminder(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const input = z.object({
      channel: reminderChannel,
      message: z.string().max(2000).optional(),
      confirmRecent: z.boolean().optional(),
    }).parse(req.body);
    const data = await sendReminder({
      feeId: String(req.params.feeId),
      adminId: req.user!._id,
      ...input,
    });
    if (data.confirmationRequired) {
      res.status(409).json({
        success: false,
        message: 'A reminder was sent within the last 24 hours. Confirm to send another.',
        data,
      });
      return;
    }
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

export async function markFeeReminderSent(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const result = await markSent(String(req.params.id), req.user!._id);
    res.json({
      success: true,
      message: result.alreadySent ? 'Reminder was already marked as sent.' : 'Reminder marked as sent.',
      data: { notificationId: result.notification._id.toString(), alreadySent: result.alreadySent },
    });
  } catch (error) {
    next(error);
  }
}

export async function getSmsReminderAction(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!req.params.token || req.params.token.length > 512) {
      throw createError('SMS link is invalid or expired.', 400);
    }
    const data = await getSmsAction(String(req.params.token));
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}
