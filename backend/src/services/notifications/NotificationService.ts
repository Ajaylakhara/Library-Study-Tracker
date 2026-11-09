import mongoose from 'mongoose';
import {
  Notification,
  NotificationType,
  NotificationChannel,
  NotificationStatus,
} from '../../models/Notification';
import { User, IUser } from '../../models/User';
import { templates } from './templates';

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
    const message = opts.message ?? templates[type].buildMessage(vars);
    const baseDoc = {
      user: new mongoose.Types.ObjectId(userId),
      type,
      vars,
      message,
      sessionId: sessionId ? new mongoose.Types.ObjectId(sessionId) : null,
      feeId: feeId ? new mongoose.Types.ObjectId(feeId) : null,
      studentNameSnapshot: nameSnap,
      studentPhoneSnapshot: phoneSnap,
      actionStatus: type === 'overtime_admin' ? 'open' : null,
      attempts: 0,
    };

    const targets = NotificationService.resolveTargets(user, type, opts.includeInApp !== false);
    for (const target of targets) {
      try {
        await Notification.create({
          ...baseDoc,
          channel: target.channel,
          status: target.status,
        });
      } catch (error: unknown) {
        if ((error as { code?: number }).code !== 11000) {
          console.error(`[NotificationService] Failed to enqueue ${type}/${target.channel}:`, error);
        }
      }
    }
  }

  static async enqueueAdmin(
    opts: Omit<EnqueueOptions, 'userId'> & {
      studentName?: string;
      studentPhone?: string;
      manualStudentId?: mongoose.Types.ObjectId | string;
      manualMessage?: string;
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
      await NotificationService.enqueue({
        ...opts,
        userId: admin._id,
        studentNameSnapshot,
        studentPhoneSnapshot,
      });

      if (admin.telegramChatId) {
        await NotificationService.createOne({
          ...opts,
          userId: admin._id,
          channel: 'telegram',
          status: 'queued',
          studentNameSnapshot,
          studentPhoneSnapshot,
        });
      }
    }

    if (opts.manualStudentId && (opts.type === 'overtime_admin')) {
      await NotificationService.enqueueManualOvertime(opts, studentNameSnapshot, studentPhoneSnapshot);
    }
  }

  private static resolveTargets(
    user: IUser,
    type: NotificationType,
    includeInApp: boolean
  ): NotificationTarget[] {
    const targets: NotificationTarget[] = includeInApp
      ? [{ channel: 'inapp', status: 'queued' }]
      : [];
    if (user.role !== 'student') return targets;

    const canSendTelegram =
      type === 'approved' ||
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

  private static async enqueueManualOvertime(
    opts: Omit<EnqueueOptions, 'userId'> & {
      manualStudentId?: mongoose.Types.ObjectId | string;
      manualMessage?: string;
    },
    studentNameSnapshot: string | null,
    studentPhoneSnapshot: string | null
  ): Promise<void> {
    const student = await User.findOne({
      _id: opts.manualStudentId,
      role: 'student',
      isDeleted: false,
    }).select('+telegramChatId');
    if (!student) return;

    const manualText =
      opts.manualMessage ??
      `Hi ${student.name}, your study shift ended at ${opts.vars?.shiftEndsAt ?? 'the scheduled time'} and you are in overtime. Please check out or contact the librarian.`;

    await NotificationService.enqueue({
      userId: student._id,
      type: 'overtime_admin',
      vars: opts.vars,
      sessionId: opts.sessionId,
      studentNameSnapshot: studentNameSnapshot ?? student.name,
      studentPhoneSnapshot: studentPhoneSnapshot ?? student.phone ?? null,
      message: manualText,
      includeInApp: false,
    });
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
    try {
      await Notification.create({
        user: new mongoose.Types.ObjectId(userId),
        type,
        vars,
        message: opts.message ?? templates[type].buildMessage(vars),
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
        console.error(`[NotificationService] Failed to enqueue ${type}/${channel}:`, error);
      }
    }
  }
}
