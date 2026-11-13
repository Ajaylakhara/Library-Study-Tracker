import mongoose from 'mongoose';
import {
  Notification,
  NotificationType,
  NotificationChannel,
  NotificationStatus,
} from '../../models/Notification';
import { User, IUser } from '../../models/User';
import { templates } from './templates';
import { getLibraryNameOrDefault } from '../librarySettings';

export interface EnqueueOptions {
  userId: mongoose.Types.ObjectId | string;
  type: NotificationType;
  vars?: Record<string, string | number>;
  sessionId?: mongoose.Types.ObjectId | string | null;
  feeId?: mongoose.Types.ObjectId | string | null;
  studentNameSnapshot?: string | null;
  studentPhoneSnapshot?: string | null;
  message?: string;
  includeInApp?: boolean;
  forceTelegram?: boolean;
}

interface NotificationTarget {
  channel: NotificationChannel;
  status: NotificationStatus;
}

export class NotificationService {
  static async enqueue(opts: EnqueueOptions): Promise<void> {
    const {
      userId,
      type,
      vars = {},
      sessionId = null,
      feeId = null,
      studentNameSnapshot = null,
      studentPhoneSnapshot = null,
    } = opts;

    const user = await User.findById(userId).select('+telegramChatId');
    if (!user || (user as unknown as { isDeleted?: boolean }).isDeleted) return;

    const nameSnap =
      studentNameSnapshot ??
      (user.role === 'student' ? user.name : (vars.studentName ? String(vars.studentName) : null));
    const phoneSnap =
      studentPhoneSnapshot ??
      (user.role === 'student' ? user.phone ?? null : (vars.studentPhone ? String(vars.studentPhone) : null));
    const brandedVars = { ...vars, libraryName: vars.libraryName ?? await getLibraryNameOrDefault() };
    const message = opts.message ?? templates[type].buildMessage(brandedVars);
    const baseDoc = {
      user: new mongoose.Types.ObjectId(userId),
      type,
      vars: brandedVars,
      message,
      sessionId: sessionId ? new mongoose.Types.ObjectId(sessionId) : null,
      feeId: feeId ? new mongoose.Types.ObjectId(feeId) : null,
      studentNameSnapshot: nameSnap,
      studentPhoneSnapshot: phoneSnap,
      actionStatus: type === 'overtime_admin' ? 'open' : null,
      attempts: 0,
    };

    const targets = NotificationService.resolveTargets(
      user,
      type,
      opts.includeInApp !== false,
      opts.forceTelegram === true
    );
    for (const target of targets) {
      try {
        await Notification.create({
          ...baseDoc,
          channel: target.channel,
          status: target.status,
        });
      } catch (error: unknown) {
        if ((error as { code?: number }).code !== 11000) {
          console.error(
            `[NotificationService] Failed to enqueue ${type}/${target.channel} (${error instanceof Error ? error.name : 'UnknownError'}).`
          );
        }
      }
    }
  }

  static async enqueueAdmin(
    opts: Omit<EnqueueOptions, 'userId'> & {
      studentName?: string;
      studentPhone?: string;
      repeat?: boolean;
    }
  ): Promise<void> {
    const admins = await User.find({
      role: 'admin',
      status: 'approved',
      isDeleted: false,
    }).select('_id +telegramChatId');

    const studentNameSnapshot =
      opts.studentName ?? (opts.vars?.studentName ? String(opts.vars.studentName) : null);
    const studentPhoneSnapshot =
      opts.studentPhone ?? (opts.vars?.studentPhone ? String(opts.vars.studentPhone) : null);

    for (const admin of admins) {
      const channels: NotificationChannel[] = ['inapp'];
      if (admin.telegramChatId) channels.push('telegram');
      for (const channel of channels) {
        const create = async () => {
          await NotificationService.createOne({
            userId: admin._id,
            type: opts.type,
            vars: opts.vars,
            sessionId: opts.sessionId,
            feeId: opts.feeId,
            studentNameSnapshot,
            studentPhoneSnapshot,
            message: opts.message,
            channel,
            status: 'queued',
          });
        };
        if (opts.repeat && opts.type === 'overtime_admin' && opts.sessionId) {
          const brandedVars = {
            ...opts.vars,
            libraryName: opts.vars?.libraryName ?? await getLibraryNameOrDefault(),
          };
          const message = opts.message ?? templates[opts.type].buildMessage(brandedVars);
          const refreshed = await Notification.findOneAndUpdate(
            {
              user: admin._id,
              type: opts.type,
              sessionId: opts.sessionId,
              channel,
            },
            {
              $set: {
                vars: brandedVars,
                message,
                status: 'queued',
                attempts: 0,
                lastError: null,
                warning: null,
                sentAt: null,
                read: false,
                readAt: null,
                actionStatus: 'open',
                resolvedAt: null,
              },
            },
            { new: true }
          );
          if (!refreshed) await create();
        } else {
          await create();
        }
      }
    }

  }

  private static resolveTargets(
    user: IUser,
    type: NotificationType,
    includeInApp: boolean,
    forceTelegram: boolean
  ): NotificationTarget[] {
    const targets: NotificationTarget[] = includeInApp
      ? [{ channel: 'inapp', status: 'queued' }]
      : [];
    if (user.role !== 'student') return targets;

    const canSendTelegram =
      type === 'approved' ||
      forceTelegram ||
      (user.preferredChannel === 'telegram' &&
        ['shift_reminder', 'shift_ended', 'fee_unpaid', 'overtime_admin'].includes(type));
    if (user.telegramChatId && canSendTelegram) {
      targets.push({ channel: 'telegram', status: 'queued' });
    }

    if (type !== 'fee_unpaid' && type !== 'overtime_admin') return targets;

    if (user.preferredChannel === 'telegram' && user.telegramChatId) return targets;
    const channel: NotificationChannel = user.preferredChannel === 'sms' ? 'sms' : 'whatsapp';
    if (channel === 'whatsapp' || channel === 'sms') {
      targets.push({ channel, status: 'manual_pending' });
    }
    return targets;
  }

  private static async createOne(
    opts: EnqueueOptions & {
      userId: mongoose.Types.ObjectId | string;
      channel: NotificationChannel;
      status: NotificationStatus;
      message?: string;
    }
  ): Promise<void> {
    const {
      userId,
      type,
      vars = {},
      sessionId = null,
      feeId = null,
      studentNameSnapshot = null,
      studentPhoneSnapshot = null,
      channel,
      status,
    } = opts;
    const brandedVars = { ...vars, libraryName: vars.libraryName ?? await getLibraryNameOrDefault() };
    try {
      await Notification.create({
        user: new mongoose.Types.ObjectId(userId),
        type,
        vars: brandedVars,
        message: opts.message ?? templates[type].buildMessage(brandedVars),
        sessionId: sessionId ? new mongoose.Types.ObjectId(sessionId) : null,
        feeId: feeId ? new mongoose.Types.ObjectId(feeId) : null,
        studentNameSnapshot,
        studentPhoneSnapshot,
        actionStatus: type === 'overtime_admin' ? 'open' : null,
        channel,
        status,
        attempts: 0,
      });
    } catch (error: unknown) {
      if ((error as { code?: number }).code !== 11000) {
        console.error(
          `[NotificationService] Failed to enqueue ${type}/${channel} (${error instanceof Error ? error.name : 'UnknownError'}).`
        );
      }
    }
  }
}
