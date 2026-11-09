import mongoose from 'mongoose';
import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth';
import { Notification } from '../models/Notification';
import { createError } from '../middleware/errorHandler';
import { recordManualNotificationSent } from '../services/notifications/adminBotHandlers';

const MANUAL_NOTIFICATION_TYPES = ['overtime_admin', 'fee_unpaid'];

export async function getManualNotifications(
  _req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const notifications = await Notification.find({
      status: 'manual_pending',
      type: { $in: MANUAL_NOTIFICATION_TYPES },
      channel: { $in: ['whatsapp', 'sms'] },
    })
      .sort({ createdAt: 1 })
      .populate('user', 'name phone');

    const items = notifications.map((notification) => {
      const user = notification.user as unknown as {
        name?: string;
        phone?: string;
      } | null;
      const phone = notification.studentPhoneSnapshot ?? user?.phone;
      const message = notification.message || '';
      let link: string | null = null;
      if (phone) {
        const encodedMessage = encodeURIComponent(message);
        link =
          notification.channel === 'whatsapp'
            ? `https://wa.me/91${phone}?text=${encodedMessage}`
            : `sms:+91${phone}?body=${encodedMessage}`;
      }

      return {
        id: notification._id.toString(),
        studentName: notification.studentNameSnapshot ?? user?.name ?? 'Unknown',
        message,
        channel: notification.channel,
        link,
      };
    });

    res.json({ success: true, data: { items } });
  } catch (error) {
    next(error);
  }
}

export async function markManualNotificationSent(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) {
      throw createError('Notification not found.', 404);
    }

    const result = await recordManualNotificationSent({
      notificationId: String(req.params.id),
      admin: req.user!,
    });

    if (result.success) {
      res.json({ success: true, message: 'Notification marked as sent.' });
      return;
    }

    if (result.notFound) {
      throw createError('Notification not found.', 404);
    }

    if (result.alreadyMarked) {
      throw createError('This notification is no longer waiting to be sent.', 409);
    }
  } catch (error) {
    next(error);
  }
}
