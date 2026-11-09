import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import bcrypt from 'bcryptjs';
import { randomInt } from 'crypto';
import mongoose from 'mongoose';
import request from 'supertest';
import app from '../src/app';
import { config } from '../src/config';
import { Fee } from '../src/models/Fee';
import { Notification } from '../src/models/Notification';
import { Seat } from '../src/models/Seat';
import { Session } from '../src/models/Session';
import { User } from '../src/models/User';
import { releaseStudentSeat } from '../src/services/students/releaseStudentSeat';
import { getAssignableSeatNumbers } from '../src/utils/seatAssignments';

const userIds: mongoose.Types.ObjectId[] = [];
const sessionIds: mongoose.Types.ObjectId[] = [];
const feeIds: mongoose.Types.ObjectId[] = [];
const notificationIds: mongoose.Types.ObjectId[] = [];
let adminCookie: string;
let disabledSeat: { id: mongoose.Types.ObjectId; wasActive: boolean } | null = null;

async function uniquePhone(): Promise<string> {
  for (;;) {
    const phone = `9${randomInt(100000000, 1000000000)}`;
    if (!(await User.exists({ phone }))) return phone;
  }
}

async function createStudent(status: 'pending' | 'approved' | 'rejected' | 'blocked' = 'approved') {
  const [seatNumber] = await getAssignableSeatNumbers();
  if (seatNumber === undefined) throw new Error('No test seat is available.');
  const pinHash = await bcrypt.hash('654321', 4);
  const student = await User.create({
    name: 'Seat Release Test Student',
    phone: await uniquePhone(),
    pinHash,
    role: 'student',
    status,
    seatNumber,
    shiftHours: 4,
  });
  userIds.push(student._id);
  return { student, seatNumber };
}

async function createSession(
  studentId: mongoose.Types.ObjectId,
  seatNumber: number,
  checkInAt = new Date(Date.now() - 30 * 60 * 1000)
) {
  const seat = await Seat.findOne({ number: seatNumber });
  if (!seat) throw new Error(`Test seat ${seatNumber} was not seeded.`);
  const session = await Session.create({
    student: studentId,
    seat: seat._id,
    shiftHours: 4,
    checkInAt,
    shiftEndsAt: new Date(checkInAt.getTime() + 4 * 60 * 60 * 1000),
    status: 'active',
  });
  sessionIds.push(session._id);
  return session;
}

describe('student seat release', () => {
  beforeAll(async () => {
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 8000, bufferCommands: false });
    }

    const adminPhone = await uniquePhone();
    const pinHash = await bcrypt.hash('654321', 4);
    const admin = await User.create({
      name: 'Seat Release Test Admin',
      phone: adminPhone,
      pinHash,
      role: 'admin',
      status: 'approved',
      monthlyFee: 0,
    });
    userIds.push(admin._id);
    const login = await request(app).post('/api/auth/login').send({ phone: adminPhone, pin: '654321' });
    adminCookie = login.headers['set-cookie']?.[0] ?? '';
    if (!adminCookie) throw new Error('Could not authenticate the test admin.');
  });

  afterAll(async () => {
    if (disabledSeat) {
      await Seat.updateOne({ _id: disabledSeat.id }, { $set: { isActive: disabledSeat.wasActive } });
      disabledSeat = null;
    }

    if (userIds.length > 0) {
      const [sessions, fees, notifications] = await Promise.all([
        Session.find({ student: { $in: userIds } }).select('_id'),
        Fee.find({ student: { $in: userIds } }).select('_id'),
        Notification.find({ user: { $in: userIds } }).select('_id'),
      ]);
      const uniqueIds = (ids: mongoose.Types.ObjectId[]) =>
        [...new Map(ids.map((id) => [id.toString(), id])).values()];
      const cleanup: Promise<unknown>[] = [User.deleteMany({ _id: { $in: userIds } })];
      const ownedSessionIds = uniqueIds([...sessions.map(({ _id }) => _id), ...sessionIds]);
      const ownedFeeIds = uniqueIds([...fees.map(({ _id }) => _id), ...feeIds]);
      const ownedNotificationIds = uniqueIds([...notifications.map(({ _id }) => _id), ...notificationIds]);
      if (ownedSessionIds.length) cleanup.push(Session.deleteMany({ _id: { $in: ownedSessionIds } }));
      if (ownedFeeIds.length) cleanup.push(Fee.deleteMany({ _id: { $in: ownedFeeIds } }));
      if (ownedNotificationIds.length) {
        cleanup.push(Notification.deleteMany({ _id: { $in: ownedNotificationIds } }));
      }
      await Promise.all(cleanup);
    }
    await mongoose.disconnect();
    globalThis.mongooseConnectionPromise = undefined;
  });

  it('makes a deleted student’s seat available again', async () => {
    const { student, seatNumber } = await createStudent();
    const before = await request(app).get('/api/auth/seats/available');
    expect(before.body.data).not.toContain(seatNumber);

    const response = await request(app)
      .delete(`/api/admin/students/${student._id}`)
      .set('Cookie', adminCookie);
    expect(response.status).toBe(200);
    const deletedStudent = await User.findById(student._id);
    expect(deletedStudent?.seatNumber).toBeUndefined();
    expect(deletedStudent?.shiftHours).toBeUndefined();

    const after = await request(app).get('/api/auth/seats/available');
    expect(after.body.data).toContain(seatNumber);
  });

  it('releases the seat when an admin blocks a student', async () => {
    const { student, seatNumber } = await createStudent();
    const response = await request(app)
      .patch(`/api/admin/students/${student._id}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'blocked' });

    expect(response.status).toBe(200);
    expect((await User.findById(student._id))?.seatNumber).toBeUndefined();
    expect(await getAssignableSeatNumbers()).toContain(seatNumber);
  });

  it('releases the seat when an admin rejects a student', async () => {
    const { student, seatNumber } = await createStudent('pending');
    const response = await request(app)
      .patch(`/api/admin/students/${student._id}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'rejected' });

    expect(response.status).toBe(200);
    const rejectionNotifications = await Notification.find({ user: student._id }).select('_id');
    notificationIds.push(...rejectionNotifications.map(({ _id }) => _id));
    expect((await User.findById(student._id))?.seatNumber).toBeUndefined();
    expect(await getAssignableSeatNumbers()).toContain(seatNumber);
  });

  it('does not reapprove a blocked student until a seat and shift are assigned again', async () => {
    const { student } = await createStudent();
    const blocked = await request(app)
      .patch(`/api/admin/students/${student._id}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'blocked' });
    expect(blocked.status).toBe(200);

    const response = await request(app)
      .patch(`/api/admin/students/${student._id}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'approved' });

    expect(response.status).toBe(409);
    expect(response.body.message).toMatch(/choose an available seat and shift/i);
  });

  it('allows a blocked student to return after assigning a currently available seat', async () => {
    const { student } = await createStudent();
    const blocked = await request(app)
      .patch(`/api/admin/students/${student._id}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'blocked' });
    expect(blocked.status).toBe(200);

    const [seatNumber] = await getAssignableSeatNumbers();
    if (seatNumber === undefined) throw new Error('No test seat is available for reassignment.');
    const edit = await request(app)
      .patch(`/api/admin/students/${student._id}`)
      .set('Cookie', adminCookie)
      .send({ seatNumber, shiftHours: 12 });
    expect(edit.status).toBe(200);

    const approved = await request(app)
      .patch(`/api/admin/students/${student._id}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'approved' });
    expect(approved.status).toBe(200);
    expect(approved.body.data.seatNumber).toBe(seatNumber);
  });

  it('does not let a blocked student reclaim a seat reassigned to another student', async () => {
    const { student, seatNumber } = await createStudent();
    const blocked = await request(app)
      .patch(`/api/admin/students/${student._id}/status`)
      .set('Cookie', adminCookie)
      .send({ status: 'blocked' });
    expect(blocked.status).toBe(200);

    const replacement = await createStudent();
    await User.updateOne({ _id: replacement.student._id }, { $set: { seatNumber } });
    const response = await request(app)
      .patch(`/api/admin/students/${student._id}`)
      .set('Cookie', adminCookie)
      .send({ seatNumber, shiftHours: 4 });

    expect(response.status).toBe(409);
    expect(response.body.message).toMatch(/unavailable.*choose another seat/i);
    expect((await User.findById(replacement.student._id))?.seatNumber).toBe(seatNumber);
  });

  it('force-checks out an active session before releasing the student’s seat', async () => {
    const { student, seatNumber } = await createStudent();
    const activeSession = await createSession(student._id, seatNumber);

    const response = await request(app)
      .delete(`/api/admin/students/${student._id}`)
      .set('Cookie', adminCookie);

    expect(response.status).toBe(200);
    const completed = await Session.findById(activeSession._id);
    expect(completed?.status).toBe('completed');
    expect(completed?.checkoutType).toBe('forced');
    expect(completed?.durationMinutes).toBeGreaterThan(0);
    expect((await User.findById(student._id))?.seatNumber).toBeUndefined();
    expect((await User.findById(student._id))?.isDeleted).toBe(true);
    const liveSeats = await request(app).get('/api/admin/seats/live').set('Cookie', adminCookie);
    expect(liveSeats.body.data.find((seat: { seatNumber: number }) => seat.seatNumber === seatNumber).isOccupied).toBe(false);
  });

  it('returns live seats even when an active session references a missing seat record', async () => {
    const { student } = await createStudent();
    const orphanedSession = await Session.create({
      student: student._id,
      seat: new mongoose.Types.ObjectId(),
      shiftHours: 4,
      checkInAt: new Date(),
      shiftEndsAt: new Date(Date.now() + 4 * 60 * 60 * 1000),
      status: 'active',
    });
    sessionIds.push(orphanedSession._id);

    const response = await request(app)
      .get('/api/admin/seats/live')
      .set('Cookie', adminCookie);

    expect(response.status).toBe(200);
    expect(response.body.data).toEqual(expect.arrayContaining([
      expect.objectContaining({ seatNumber: expect.any(Number), isActive: expect.any(Boolean) }),
    ]));
  });

  it('leaves an admin-disabled seat disabled after deleting its student', async () => {
    const { student, seatNumber } = await createStudent();
    const seat = await Seat.findOne({ number: seatNumber });
    if (!seat) throw new Error('Test seat was not found.');
    disabledSeat = { id: seat._id, wasActive: seat.isActive };
    await Seat.updateOne({ _id: seat._id }, { $set: { isActive: false } });

    const response = await request(app)
      .delete(`/api/admin/students/${student._id}`)
      .set('Cookie', adminCookie);
    expect(response.status).toBe(200);
    expect((await Seat.findById(seat._id))?.isActive).toBe(false);
  });

  it('does not alter another student’s active session when releasing a seat assignment', async () => {
    const { student: releasedStudent, seatNumber } = await createStudent();
    const { student: otherStudent } = await createStudent();
    const seat = await Seat.findOne({ number: seatNumber });
    if (!seat) throw new Error('Test seat was not found.');
    await User.updateOne({ _id: otherStudent._id }, { $set: { seatNumber } });
    const otherSession = await Session.create({
      student: otherStudent._id,
      seat: seat._id,
      shiftHours: 4,
      checkInAt: new Date(),
      shiftEndsAt: new Date(Date.now() + 4 * 60 * 60 * 1000),
      status: 'active',
    });
    sessionIds.push(otherSession._id);

    await releaseStudentSeat(releasedStudent._id);

    expect((await Session.findById(otherSession._id))?.status).toBe('active');
    expect((await User.findById(otherStudent._id))?.seatNumber).toBeDefined();
    expect((await Seat.findById(seat._id))?.isActive).toBe(true);
    expect(await getAssignableSeatNumbers()).not.toContain(seatNumber);
  });

  it('is harmless when the same assignment is released twice', async () => {
    const { student } = await createStudent();
    await releaseStudentSeat(student._id);
    const released = await User.findById(student._id);
    await releaseStudentSeat(student._id);
    const repeated = await User.findById(student._id);

    expect(repeated?.seatNumber).toBeUndefined();
    expect(repeated?.shiftHours).toBeUndefined();
    expect(repeated?.updatedAt.getTime()).toBe(released?.updatedAt.getTime());
  });

  it('does not restore a deleted student into a seat now claimed by someone else', async () => {
    const { student, seatNumber } = await createStudent();
    const deleted = await request(app)
      .delete(`/api/admin/students/${student._id}`)
      .set('Cookie', adminCookie);
    expect(deleted.status).toBe(200);

    const replacement = await createStudent();
    await User.updateOne({ _id: replacement.student._id }, { $set: { seatNumber } });
    const response = await request(app)
      .patch(`/api/admin/students/${student._id}/restore`)
      .set('Cookie', adminCookie)
      .send({ seatNumber, shiftHours: 4 });

    expect(response.status).toBe(409);
    expect(response.body.message).toMatch(/unavailable.*choose another seat/i);
    expect((await User.findById(student._id))?.isDeleted).toBe(true);
  });

  it('restores a deleted student as pending with a newly selected available seat', async () => {
    const { student } = await createStudent();
    const deleted = await request(app)
      .delete(`/api/admin/students/${student._id}`)
      .set('Cookie', adminCookie);
    expect(deleted.status).toBe(200);

    const [availableSeat] = await getAssignableSeatNumbers();
    if (availableSeat === undefined) throw new Error('No test seat is available for restoration.');
    const response = await request(app)
      .patch(`/api/admin/students/${student._id}/restore`)
      .set('Cookie', adminCookie)
      .send({ seatNumber: availableSeat, shiftHours: 12 });

    expect(response.status).toBe(200);
    expect(response.body.data.status).toBe('pending');
    expect(response.body.data.seatNumber).toBe(availableSeat);
    expect(response.body.data.shiftHours).toBe(12);
  });

  it('preserves session, fee, and notification history after soft delete', async () => {
    const { student, seatNumber } = await createStudent();
    const seat = await Seat.findOne({ number: seatNumber });
    if (!seat) throw new Error('Test seat was not found.');
    const pastSession = await Session.create({
      student: student._id,
      seat: seat._id,
      shiftHours: 4,
      checkInAt: new Date(Date.now() - 5 * 60 * 60 * 1000),
      shiftEndsAt: new Date(Date.now() - 60 * 60 * 1000),
      checkOutAt: new Date(Date.now() - 60 * 60 * 1000),
      durationMinutes: 240,
      status: 'completed',
      checkoutType: 'manual',
    });
    sessionIds.push(pastSession._id);
    const fee = await Fee.create({
      student: student._id,
      month: '2098-01',
      amount: 1000,
      status: 'unpaid',
    });
    feeIds.push(fee._id);
    const notification = await Notification.create({
      user: student._id,
      type: 'approved',
      vars: {},
      message: 'Test history notification',
      channel: 'inapp',
      status: 'queued',
    });
    notificationIds.push(notification._id);

    const response = await request(app)
      .delete(`/api/admin/students/${student._id}`)
      .set('Cookie', adminCookie);
    expect(response.status).toBe(200);
    expect(await Session.exists({ _id: pastSession._id })).toBeTruthy();
    expect(await Fee.exists({ _id: fee._id })).toBeTruthy();
    expect(await Notification.exists({ _id: notification._id })).toBeTruthy();
  });
});
