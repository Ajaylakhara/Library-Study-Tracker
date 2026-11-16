import { afterAll, beforeAll, describe, expect, it, jest } from '@jest/globals';
import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { config } from '../src/config';
import { Notification } from '../src/models/Notification';
import { Seat } from '../src/models/Seat';
import { Session } from '../src/models/Session';
import { User } from '../src/models/User';
import { NotificationService } from '../src/services/notifications/NotificationService';
import { runShiftMonitor } from '../src/jobs/shiftMonitor';
import { processQueuedNotifications } from '../src/jobs/notificationWorker';

/**
 * Delivery guarantees for overtime alerts. Needs the MongoDB test database
 * (MONGODB_TEST_URI), like the other integration tests.
 */
describe('overtime alert delivery', () => {
  const suffix = String(Date.now()).slice(-8);
  const createdNotificationIds: mongoose.Types.ObjectId[] = [];
  let admin: InstanceType<typeof User>;
  let student: InstanceType<typeof User>;
  let seatId: mongoose.Types.ObjectId;
  const sessionIds: mongoose.Types.ObjectId[] = [];

  async function makeSession(status: 'active' | 'completed', shiftEndsAt: Date) {
    const session = await Session.create({
      student: student._id,
      seat: seatId,
      shiftHours: 4,
      checkInAt: new Date(shiftEndsAt.getTime() - 4 * 60 * 60_000),
      shiftEndsAt,
      status,
      ...(status === 'completed' ? { checkOutAt: new Date(), checkoutType: 'manual' } : {}),
    });
    sessionIds.push(session._id);
    return session;
  }

  beforeAll(async () => {
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 15000 });
    }
    const pinHash = await bcrypt.hash('123456', 4);
    admin = await User.create({
      name: 'Delivery Test Admin',
      phone: `7${suffix}1`.slice(0, 10).padEnd(10, '1'),
      pinHash,
      role: 'admin',
      status: 'approved',
      telegramChatId: `delivery-test-${suffix}`,
    });
    student = await User.create({
      name: 'Delivery Test Student',
      phone: `6${suffix}2`.slice(0, 10).padEnd(10, '2'),
      pinHash,
      role: 'student',
      status: 'approved',
    });
    const seat = await Seat.findOne({ number: 70 });
    if (!seat) throw new Error('Seat 70 is missing from the test database.');
    seatId = seat._id;
  });

  afterAll(async () => {
    await Notification.deleteMany({
      $or: [
        { _id: { $in: createdNotificationIds } },
        { sessionId: { $in: sessionIds } },
        { user: { $in: [admin?._id, student?._id] } },
      ],
    });
    await Session.deleteMany({ _id: { $in: sessionIds } });
    await User.deleteMany({ _id: { $in: [admin?._id, student?._id] } });
  });

  it('does not mark the alert as sent when creating the notification fails, and recovers next run', async () => {
    const shiftEndsAt = new Date(Date.now() - 20 * 60_000);
    const session = await makeSession('active', shiftEndsAt);
    const now = new Date();

    const spy = jest
      .spyOn(NotificationService, 'enqueueAdmin')
      .mockRejectedValueOnce(new Error('simulated database failure'));
    const failedRun = await runShiftMonitor({ sessionIds: [session._id.toString()], now });
    spy.mockRestore();

    expect(failedRun.errors).toBe(1);
    const afterFailure = await Session.findById(session._id);
    expect(afterFailure?.alertsSent.overtime).toBe(false);
    expect(afterFailure?.overtimeAdminAlertedAt).toBeNull();

    const okRun = await runShiftMonitor({ sessionIds: [session._id.toString()], now });
    expect(okRun.errors).toBe(0);
    const afterRecovery = await Session.findById(session._id);
    expect(afterRecovery?.alertsSent.overtime).toBe(true);
    expect(afterRecovery?.overtimeAdminAlertedAt).toEqual(now);

    const telegram = await Notification.findOne({
      sessionId: session._id,
      type: 'overtime_admin',
      channel: 'telegram',
      user: admin._id,
    });
    expect(telegram?.status).toBe('queued');
  });

  it('retries a recently failed Telegram notification and delivers it', async () => {
    const failed = await Notification.create({
      user: admin._id,
      type: 'shift_reminder',
      channel: 'telegram',
      status: 'failed',
      attempts: 3,
      message: 'retry me',
      lastError: 'earlier outage',
    });
    createdNotificationIds.push(failed._id);

    const delivered: string[] = [];
    const sender = async (_chatId: string, text: string): Promise<void> => {
      delivered.push(text);
    };
    await processQueuedNotifications(sender, { notificationIds: [failed._id.toString()] });

    const updated = await Notification.findById(failed._id);
    expect(delivered).toEqual(['retry me']);
    expect(updated?.status).toBe('sent');
    expect(updated?.lastError).toBeNull();
    expect(updated?.lastAttemptAt).toBeTruthy();
  });

  it('backs off after a failed retry instead of retrying immediately', async () => {
    const failed = await Notification.create({
      user: admin._id,
      type: 'shift_reminder',
      channel: 'telegram',
      status: 'failed',
      attempts: 3,
      message: 'still failing',
    });
    createdNotificationIds.push(failed._id);

    const sender = async (): Promise<void> => {
      throw new Error('Telegram is down');
    };
    await processQueuedNotifications(sender, { notificationIds: [failed._id.toString()] });

    const updated = await Notification.findById(failed._id);
    expect(updated?.status).toBe('failed');
    expect(updated?.attempts).toBe(4);
    expect(updated?.lastError).toBe('Telegram is down');
    expect(updated?.nextAttemptAt && updated.nextAttemptAt.getTime()).toBeGreaterThan(Date.now());
  });

  it('does not retry a permanently failed notification', async () => {
    const blocked = await Notification.create({
      user: admin._id,
      type: 'shift_reminder',
      channel: 'telegram',
      status: 'failed',
      attempts: 3,
      permanentFailure: true,
      message: 'blocked',
    });
    createdNotificationIds.push(blocked._id);

    let calls = 0;
    const sender = async (): Promise<void> => {
      calls++;
    };
    const result = await processQueuedNotifications(sender, { notificationIds: [blocked._id.toString()] });
    expect(result.processed).toBe(0);
    expect(calls).toBe(0);
  });

  it('does not resend a failed overtime alert after the session has ended', async () => {
    const session = await makeSession('completed', new Date(Date.now() - 60 * 60_000));
    const stale = await Notification.create({
      user: admin._id,
      type: 'overtime_admin',
      channel: 'telegram',
      status: 'failed',
      attempts: 3,
      sessionId: session._id,
      message: 'stale overtime',
    });
    createdNotificationIds.push(stale._id);

    let calls = 0;
    const sender = async (): Promise<void> => {
      calls++;
    };
    await processQueuedNotifications(sender, { notificationIds: [stale._id.toString()] });

    expect(calls).toBe(0);
    const updated = await Notification.findById(stale._id);
    expect(updated?.permanentFailure).toBe(true);
    expect(updated?.lastError).toMatch(/already ended/i);
  });
});
