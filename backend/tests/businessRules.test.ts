import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import mongoose from 'mongoose';
import dns from 'dns';
import { randomInt } from 'crypto';
import app from '../src/app';
import { User } from '../src/models/User';
import { Seat } from '../src/models/Seat';
import { Session } from '../src/models/Session';
import { Fee } from '../src/models/Fee';
import { Notification } from '../src/models/Notification';
import { config } from '../src/config';
import { runShiftMonitor } from '../src/jobs/shiftMonitor';

import bcrypt from 'bcryptjs';

dns.setServers(['8.8.8.8', '8.8.4.4']);

describe('Backend Business Rules & Integration Tests', () => {
  let adminCookie: string;
  let adminUserId: string;
  let studentCookie: string;
  let student2Cookie: string;
  let studentId: string;
  let student2Id: string;
  let feeId: string;
  let softDeleteTestPhone = '';
  let testUserIds: mongoose.Types.ObjectId[] = [];

  let testAdminPhone: string;
  const testAdminPin = '654321';
  let testStudentPhone: string;
  let testStudent2Phone: string;
  let testAdminAddedStudentPhone: string;
  let testAdminAddedStudentWithPinPhone: string;
  let testUnauthorizedStudentPhone: string;
  const editedStudentEmail = () => `${testStudentPhone}@example.test`;

  async function createUniqueTestPhones(count: number): Promise<string[]> {
    const phones: string[] = [];
    while (phones.length < count) {
      const phone = `9${randomInt(100000000, 1000000000)}`;
      if (phones.includes(phone) || (await User.exists({ phone }))) continue;
      phones.push(phone);
    }
    return phones;
  }

  beforeAll(async () => {
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 15000 });
    }

    [
      testAdminPhone,
      testStudentPhone,
      testStudent2Phone,
      testAdminAddedStudentPhone,
      testAdminAddedStudentWithPinPhone,
      testUnauthorizedStudentPhone,
    ] = await createUniqueTestPhones(6);

    // Seed test admin
    const pinHash = await bcrypt.hash(testAdminPin, 10);
    await User.create({
      name: 'Test Admin',
      phone: testAdminPhone,
      pinHash,
      role: 'admin',
      status: 'approved',
      monthlyFee: 0,
    });

    // Admins use the same phone + PIN login endpoint as students.
    const adminRes = await request(app)
      .post('/api/auth/login')
      .send({ phone: testAdminPhone, pin: testAdminPin });
    adminCookie = adminRes.headers['set-cookie']?.[0] || '';
    adminUserId = adminRes.body.data.id;
  });

  afterAll(async () => {
    // Cleanup
    const testUsers = await User.find({
      phone: {
        $in: [
          testAdminPhone,
          testStudentPhone,
          testStudent2Phone,
          testAdminAddedStudentPhone,
          testAdminAddedStudentWithPinPhone,
          testUnauthorizedStudentPhone,
          ...(softDeleteTestPhone ? [softDeleteTestPhone] : []),
        ],
      },
    });
    const userIds = testUsers.map((u) => u._id);
    testUserIds = userIds;
    const [sessions, fees, notifications] = await Promise.all([
      Session.find({ student: { $in: userIds } }).select('_id'),
      Fee.find({ student: { $in: userIds } }).select('_id'),
      Notification.find({ user: { $in: userIds } }).select('_id'),
    ]);
    await Session.deleteMany({ _id: { $in: sessions.map((record) => record._id) } });
    await Fee.deleteMany({ _id: { $in: fees.map((record) => record._id) } });
    await Notification.deleteMany({ _id: { $in: notifications.map((record) => record._id) } });
    await User.deleteMany({ _id: { $in: userIds } });
    await mongoose.connection.close();
  });

  // ─── 1. Registration & Validation ──────────────────────────────────────────
  describe('1. Registration and Validation', () => {
    it('should reject registration with an invalid phone number or PIN', async () => {
      const invalidPhone = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'Jane Doe',
          phone: '123',
          pin: '123456',
        });
      expect(invalidPhone.status).toBe(400);

      const invalidPin = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'Jane Doe',
          phone: testStudentPhone,
          pin: '1234',
        });
      expect(invalidPin.status).toBe(400);
    });

    it('registers students with their assigned seat and study shift', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'Student One',
          phone: testStudentPhone,
          pin: '123456',
          seatNumber: 10,
          shiftHours: 4,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.status).toBe('pending');
      expect(res.body.data.seatNumber).toBe(10);
      expect(res.body.data.shiftHours).toBe(4);
      studentId = res.body.data.id;

      const duplicateSeatRes = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'Duplicate Seat Student',
          phone: testStudent2Phone,
          pin: '123456',
          seatNumber: 10,
          shiftHours: 4,
        });
      expect(duplicateSeatRes.status).toBe(409);
      expect(duplicateSeatRes.body.message).toMatch(/seat 10 is unavailable/i);

      // Register student 2 with a different assigned seat
      const res2 = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'Student Two',
          phone: testStudent2Phone,
          pin: '123456',
          seatNumber: 11,
          shiftHours: 12,
        });
      expect(res2.status).toBe(201);
      student2Id = res2.body.data.id;

      // Approve both students
      await User.findByIdAndUpdate(studentId, { status: 'approved' });
      await User.findByIdAndUpdate(student2Id, { status: 'approved' });
    });

    it('does not allow a student to register with the admin phone number', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'Duplicate Admin Phone',
          phone: testAdminPhone,
          pin: '123456',
          seatNumber: 15,
          shiftHours: 4,
        });

      expect(res.status).toBe(409);
      expect(res.body.message).toMatch(/phone number is already registered/i);
    });
  });

  // ─── 2. Login & Session ────────────────────────────────────────────────────
  describe('2. Authentication & 401 handling', () => {
    it('returns 401 with generic error on incorrect PIN for student', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ phone: testStudentPhone, pin: '000000' });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/phone or pin is wrong/i);
    });

    it('locks the student account after five incorrect PIN attempts', async () => {
      const previousTrustProxy = app.get('trust proxy');
      app.set('trust proxy', 1);
      try {
        for (let attempt = 0; attempt < 5; attempt++) {
          const res = await request(app)
            .post('/api/auth/login')
            .set('X-Forwarded-For', '203.0.113.5')
            .send({ phone: testStudent2Phone, pin: '000000' });
          expect(res.status).toBe(401);
        }

        const lockedRes = await request(app)
          .post('/api/auth/login')
          .set('X-Forwarded-For', '203.0.113.5')
          .send({ phone: testStudent2Phone, pin: '123456' });
        expect(lockedRes.status).toBe(429);
        expect(lockedRes.body.message).toMatch(/locked/i);

        await User.findOneAndUpdate(
          { phone: testStudent2Phone },
          { failedAttempts: 0, lockedUntil: null }
        );
      } finally {
        app.set('trust proxy', previousTrustProxy);
      }
    }, 90000);

    it('rejects admin user on student phone/PIN login with 401', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ phone: testAdminPhone, pin: '123456' });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/phone or pin is wrong/i);
    });

    it('keeps the legacy admin login URL on the shared phone/PIN contract', async () => {
      const res = await request(app)
        .post('/api/auth/admin/login')
        .send({ phone: testStudentPhone, pin: '123456' });

      expect(res.status).toBe(200);
      expect(res.body.data.role).toBe('student');
    });

    it('rejects admin on a wrong PIN with 401', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ phone: testAdminPhone, pin: '000000' });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toMatch(/phone or pin is wrong/i);
    });

    it('returns set-cookie on valid admin login', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ phone: testAdminPhone, pin: testAdminPin });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.headers['set-cookie']?.[0]).toContain('token=');
      expect(res.body.data.role).toBe('admin');
    });

    it('returns set-cookie on valid student login', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ phone: testStudentPhone, pin: '123456' });

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      studentCookie = res.headers['set-cookie']?.[0] || '';
      expect(studentCookie).toContain('token=');

      // Login student 2
      const res2 = await request(app)
        .post('/api/auth/login')
        .send({ phone: testStudent2Phone, pin: '123456' });
      student2Cookie = res2.headers['set-cookie']?.[0] || '';
    });

    it('GET /api/auth/me returns the current user with no-store cache headers', async () => {
      const res = await request(app)
        .get('/api/auth/me')
        .set('Cookie', studentCookie);

      expect(res.status).toBe(200);
      expect(res.body.data.phone).toBe(testStudentPhone);
      expect(res.body.data).not.toHaveProperty('pinHash');
      expect(res.headers['cache-control']).toContain('no-store');
    });

    it('student routes never expose another student phone number', async () => {
      const responses = await Promise.all([
        request(app).get('/api/auth/me').set('Cookie', studentCookie),
        request(app).get('/api/me/status').set('Cookie', studentCookie),
        request(app).get('/api/me/seats/available').set('Cookie', studentCookie),
        request(app).get('/api/me/attendance').set('Cookie', studentCookie),
        request(app).get('/api/me/summary').query({ month: '2026-10' }).set('Cookie', studentCookie),
        request(app).get('/api/me/fees').set('Cookie', studentCookie),
        request(app).get('/api/me/profile').set('Cookie', studentCookie),
      ]);

      expect(responses.every((response) => response.status === 200)).toBe(true);
      for (const response of responses) {
        expect(JSON.stringify(response.body)).not.toContain(testStudent2Phone);
      }
      expect(responses[0].body.data.phone).toBe(testStudentPhone);
      expect(responses[1].body.data.student.phone).toBe(testStudentPhone);
      expect(responses[6].body.data.phone).toBe(testStudentPhone);
    });

    it('denies students access to admin endpoints', async () => {
      const res = await request(app)
        .get('/api/admin/students')
        .set('Cookie', studentCookie);

      expect(res.status).toBe(403);
      expect(res.body.message).toMatch(/insufficient permissions/i);
    });

    it('denies students access to admin student creation', async () => {
      const pin = '123456';
      const pinHash = await bcrypt.hash(pin, 10);
      await User.create({
        name: 'Unauthorized Student',
        phone: testUnauthorizedStudentPhone,
        pinHash,
        seatNumber: 14,
        shiftHours: 4,
        role: 'student',
        status: 'approved',
        monthlyFee: 0,
      });

      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ phone: testUnauthorizedStudentPhone, pin });
      expect(loginRes.status).toBe(200);
      const cookie = loginRes.headers['set-cookie']?.[0];
      expect(cookie).toContain('token=');
      if (!cookie) {
        throw new Error('Student login did not return an authentication cookie.');
      }

      const res = await request(app)
        .post('/api/admin/students')
        .set('Cookie', cookie)
        .send({
          name: 'Unauthorized Student',
          phone: testAdminAddedStudentWithPinPhone,
          seatNumber: 14,
          shiftHours: 4,
          monthlyFee: 0,
          whatsappOptIn: true,
          smsOptIn: true,
        });

      expect(res.status).toBe(403);
    });

    it('allows admins to add an immediately approved student and returns a generated PIN once', async () => {
      const res = await request(app)
        .post('/api/admin/students')
        .set('Cookie', adminCookie)
        .send({
          name: 'Admin Added Student',
          phone: testAdminAddedStudentPhone,
          seatNumber: 12,
          shiftHours: 4,
          monthlyFee: 1200,
          whatsappOptIn: true,
          smsOptIn: false,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.student.status).toBe('approved');
      expect(res.body.data.student.monthlyFee).toBe(1200);
      expect(res.body.data.student.seatNumber).toBe(12);
      expect(res.body.data.student.shiftHours).toBe(4);
      expect(res.body.data.student).not.toHaveProperty('pinHash');
      expect(res.body.data.pin).toMatch(/^\d{6}$/);

      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ phone: testAdminAddedStudentPhone, pin: res.body.data.pin });
      expect(loginRes.status).toBe(200);
      expect(loginRes.body.data.role).toBe('student');
    });

    it('rejects duplicate phones when an admin adds a student', async () => {
      const res = await request(app)
        .post('/api/admin/students')
        .set('Cookie', adminCookie)
        .send({
          name: 'Duplicate Student',
          phone: testAdminAddedStudentPhone,
          pin: '123456',
          seatNumber: 12,
          shiftHours: 4,
          monthlyFee: 0,
          whatsappOptIn: true,
          smsOptIn: true,
        });

      expect(res.status).toBe(409);
      expect(res.body.message).toBe('This phone number is already registered.');
    });

    it('accepts an optional six-digit PIN when an admin adds a student', async () => {
      const res = await request(app)
        .post('/api/admin/students')
        .set('Cookie', adminCookie)
        .send({
          name: 'Admin Added with PIN',
          phone: testAdminAddedStudentWithPinPhone,
          pin: '765432',
          seatNumber: 13,
          shiftHours: 12,
          monthlyFee: 0,
          whatsappOptIn: false,
          smsOptIn: true,
        });

      expect(res.status).toBe(201);
      expect(res.body.data.pin).toBe('765432');
      expect(res.body.data.student.status).toBe('approved');
      expect(res.body.data.student.seatNumber).toBe(13);
      expect(res.body.data.student.shiftHours).toBe(12);
    });

    it('generates and returns a new PIN when an admin resets a student PIN', async () => {
      const student = await User.findOne({ phone: testAdminAddedStudentPhone, role: 'student' });
      expect(student).toBeTruthy();
      await User.findByIdAndUpdate(student?._id, {
        failedAttempts: 4,
        lockedUntil: new Date(Date.now() + 60_000),
      });

      const res = await request(app)
        .post(`/api/admin/students/${student?._id}/reset-pin`)
        .set('Cookie', adminCookie);

      expect(res.status).toBe(200);
      expect(res.body.data.pin).toMatch(/^\d{6}$/);
      expect(res.body.data).not.toHaveProperty('pinHash');
      const resetStudent = await User.findById(student?._id);
      expect(resetStudent?.failedAttempts).toBe(0);
      expect(resetStudent?.lockedUntil).toBeNull();
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ phone: testAdminAddedStudentPhone, pin: res.body.data.pin });
      expect(loginRes.status).toBe(200);
    });

    it('POST /api/auth/logout without a cookie still returns 200 and sets expired HttpOnly cookie', async () => {
      const res = await request(app).post('/api/auth/logout');
      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.headers['set-cookie']?.[0]).toContain('token=;');
      expect(res.headers['set-cookie']?.[0]).toContain('HttpOnly');
    });

    it('after logout, /auth/me returns 401 using the cookies from the logout response', async () => {
      // 1. Log in a dedicated session to get a valid cookie
      const loginRes = await request(app)
        .post('/api/auth/login')
        .send({ phone: testStudentPhone, pin: '123456' });
      expect(loginRes.status).toBe(200);
      const activeCookie = loginRes.headers['set-cookie']?.[0] || '';

      // 2. Perform logout
      const logoutRes = await request(app)
        .post('/api/auth/logout')
        .set('Cookie', activeCookie);
      expect(logoutRes.status).toBe(200);
      expect(logoutRes.body.success).toBe(true);
      const expiredCookie = logoutRes.headers['set-cookie']?.[0] || '';
      expect(expiredCookie).toContain('HttpOnly');
      expect(expiredCookie).toContain('Expires=Thu, 01 Jan 1970');

      // 3. Attempt to access /api/auth/me with the cookie returned by the logout response
      const meRes = await request(app)
        .get('/api/auth/me')
        .set('Cookie', expiredCookie);
      expect(meRes.status).toBe(401);
      expect(meRes.body.success).toBe(false);
      expect(meRes.body.message).toMatch(/authentication required/i);
    });
  });

  // ─── 3. Check-In & Seat Occupancy ──────────────────────────────────────────
  describe('3. Check-in logic (selected seat and shift & 409 conflict)', () => {
    it('returns available seats as numeric seat numbers and rejects string seat values', async () => {
      const availableRes = await request(app)
        .get('/api/me/seats/available')
        .set('Cookie', studentCookie);
      expect(availableRes.status).toBe(200);
      expect(availableRes.body.data).toContain(10);
      expect(typeof availableRes.body.data[0]).toBe('number');

      const invalidRes = await request(app)
        .post('/api/me/checkin')
        .set('Cookie', studentCookie)
        .send({ seat: '10', shiftHours: 4 });
      expect(invalidRes.status).toBe(400);
    });

    it('POST /me/checkin uses the selected seat and shift', async () => {
      const wrongSeatRes = await request(app)
        .post('/api/me/checkin')
        .set('Cookie', studentCookie)
        .send({ seat: 11, shiftHours: 4 });
      expect(wrongSeatRes.status).toBe(400);
      expect(wrongSeatRes.body.message).toMatch(/assigned seat is 10/i);

      const res = await request(app)
        .post('/api/me/checkin')
        .set('Cookie', studentCookie)
        .send({ seat: 10, shiftHours: 4 });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.seatNumber).toBe(10);
      expect(res.body.data.shiftHours).toBe(4);
    });

    it('returns 409 when an already checked-in student attempts another check-in', async () => {
      const res = await request(app)
        .post('/api/me/checkin')
        .set('Cookie', studentCookie)
        .send({ seat: 11, shiftHours: 24 });

      // Student is already checked in -> returns 409
      expect(res.status).toBe(409);
      expect(res.body.message).toBe('Seat is occupied or you are already checked in. Please wait or contact admin.');
    });

    it('returns 409 when student 2 tries to check in to seat 10 while student 1 is occupying it', async () => {
      const res = await request(app)
        .post('/api/me/checkin')
        .set('Cookie', student2Cookie)
        .send({ seat: 10, shiftHours: 12 });

      expect(res.status).toBe(409);
      expect(res.body.message).toBe('Seat is occupied or you are already checked in. Please wait or contact admin.');
    });
  });

  // ─── 4. Admin Edits Profile While Session Is Active ────────────────────────
  describe('4. Admin edits student seat/shift during active session', () => {
    it('does NOT modify active session when admin edits student seatNumber and shiftHours', async () => {
      // Active session before edit
      const beforeSession = await Session.findOne({ student: studentId, status: 'active' }).populate('seat');
      expect((beforeSession?.seat as unknown as { number: number }).number).toBe(10);
      expect(beforeSession?.shiftHours).toBe(4);

      const availableSeats = await request(app)
        .get(`/api/admin/students/${studentId}/available-seats`)
        .set('Cookie', adminCookie);
      expect(availableSeats.status).toBe(200);
      expect(availableSeats.body.data).toContain(10);
      expect(availableSeats.body.data).not.toContain(11);

      const occupiedAssignmentRes = await request(app)
        .patch(`/api/admin/students/${studentId}`)
        .set('Cookie', adminCookie)
        .send({ seatNumber: 11 });
      expect(occupiedAssignmentRes.status).toBe(409);

      // Admin updates student 1 to an available seat, shift, and email
      const adminEditRes = await request(app)
        .patch(`/api/admin/students/${studentId}`)
        .set('Cookie', adminCookie)
        .send({
          seatNumber: 15,
          shiftHours: 12,
          email: editedStudentEmail(),
        });

      expect(adminEditRes.status).toBe(200);
      expect(adminEditRes.body.data.seatNumber).toBe(15);
      expect(adminEditRes.body.data.shiftHours).toBe(12);
      expect(adminEditRes.body.data.email).toBe(editedStudentEmail());

      // Check active session again: MUST REMAIN UNMODIFIED (seat 10, 4h shift)
      const afterSession = await Session.findOne({ student: studentId, status: 'active' }).populate('seat');
      expect((afterSession?.seat as unknown as { number: number }).number).toBe(10);
      expect(afterSession?.shiftHours).toBe(4);
      expect(afterSession?._id.toString()).toBe(beforeSession?._id.toString());
    });
  });

  // ─── 5. Overtime & No Auto Check-Out ────────────────────────────────────────
  describe('5. Shift monitor & No auto check-out', () => {
    it('leaves session active even 45 minutes past shiftEnd (no auto check-out)', async () => {
      // Move session shiftEndsAt to 45 minutes in the past
      const pastDate = new Date(Date.now() - 45 * 60 * 1000);
      await Session.findOneAndUpdate(
        { student: studentId, status: 'active' },
        { shiftEndsAt: pastDate }
      );

      // Run shift monitor
      await runShiftMonitor();

      // Verify session is STILL active
      const session = await Session.findOne({ student: studentId, status: 'active' });
      expect(session).not.toBeNull();
      expect(session?.status).toBe('active');
      expect(session?.checkoutType).toBeNull();
      expect(await Notification.findOne({ type: 'overtime_admin', sessionId: session?._id })).toBeNull();
    });

    it('student manually checks out cleanly from overtime', async () => {
      const res = await request(app)
        .post('/api/me/checkout')
        .set('Cookie', studentCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.durationMinutes).toBe(0);
      expect(res.body.data.studyTime).toBeDefined();

      const session = await Session.findOne({ student: studentId, status: 'active' });
      expect(session).toBeNull();
    });
  });

  // ─── 6. Fees with Optional Note ────────────────────────────────────────────
  describe('6. Fees and markFeePaid with note only', () => {
    it('marks fee as paid with an optional note', async () => {
      const fee = await Fee.create({
        student: studentId,
        month: '2026-10',
        amount: 1000,
        status: 'unpaid',
      });
      feeId = fee._id.toString();

      const res = await request(app)
        .patch(`/api/admin/fees/${feeId}/pay`)
        .set('Cookie', adminCookie)
        .send({ note: 'Paid in cash at library desk' });

      expect(res.status).toBe(200);
      expect(res.body.data.status).toBe('paid');
      expect(res.body.data.note).toBe('Paid in cash at library desk');
    });
  });

  // ─── 7. Notifications & Alerts Badge (Task B) ──────────────────────────────
  describe('7. Notifications & Alerts Badge (Task B)', () => {
    let alertId1: string;
    let alertId2: string;

    beforeAll(async () => {
      // Clean previous notifications
      // 1. Create a failed delivery alert
      const n1 = await Notification.create({
        user: studentId,
        type: 'shift_ended',
        channel: 'whatsapp',
        status: 'failed',
        message: 'Test failed notification',
        lastError: 'Provider connection timeout',
        attempts: 3,
        read: false,
        studentNameSnapshot: 'Student One',
        studentPhoneSnapshot: testStudentPhone,
      });
      alertId1 = n1._id.toString();

      // 2. Create an admin-targeted alert (overtime_admin)
      const n2 = await Notification.create({
        user: adminUserId,
        type: 'overtime_admin',
        channel: 'inapp',
        status: 'sent',
        message: 'Test overtime notification',
        read: false,
        studentNameSnapshot: 'Student One',
        studentPhoneSnapshot: testStudentPhone,
      });
      alertId2 = n2._id.toString();

      const seat = await Seat.findOne({ number: 10 });
      const overtimeSession = await Session.create({
        student: studentId,
        seat: seat!._id,
        shiftHours: 4,
        checkInAt: new Date(Date.now() - 5 * 60 * 60 * 1000),
        shiftEndsAt: new Date(Date.now() - 20 * 60 * 1000),
        status: 'active',
      });
      await Notification.updateOne({ _id: alertId2 }, {
        sessionId: overtimeSession._id,
        actionStatus: 'open',
      });

      // 3. Create a successfully sent student notification (MUST NOT be counted in admin badge)
      await Notification.create({
        user: studentId,
        type: 'shift_reminder',
        channel: 'whatsapp',
        status: 'sent',
        message: 'Test shift reminder',
        read: false,
        studentNameSnapshot: 'Student One',
      });
    });

    it('GET /api/admin/notifications/unread-count counts only unread failed and admin alerts', async () => {
      const res = await request(app)
        .get('/api/admin/notifications/unread-count')
        .set('Cookie', adminCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      // The unread failed notification and in-app overtime alert are counted.
      expect(res.body.count).toBe(2);
      expect(res.body.unreadCount).toBe(2);
    });

    it('GET /api/admin/notifications/failed uses same unreadCount source of truth and preserves snapshot', async () => {
      const res = await request(app)
        .get('/api/admin/notifications/failed')
        .set('Cookie', adminCookie);

      expect(res.status).toBe(200);
      expect(res.body.count).toBe(2);
      expect(res.body.data.length).toBe(2);
      expect(res.body.data.some((row: { studentNameSnapshot: string }) =>
        row.studentNameSnapshot === 'Student One'
      )).toBe(true);
    });

    it('temporarily disables admin overtime follow-up routes', async () => {
      const unauthorized = await request(app).get('/api/admin/notifications/needs-action');
      expect(unauthorized.status).toBe(401);

      const forbidden = await request(app)
        .get('/api/admin/notifications/needs-action')
        .set('Cookie', studentCookie);
      expect(forbidden.status).toBe(403);

      const res = await request(app)
        .get('/api/admin/notifications/needs-action')
        .set('Cookie', adminCookie);
      expect(res.status).toBe(404);
    });

    it('disables contact recording and still resolves existing alerts on student checkout', async () => {
      const forbidden = await request(app)
        .patch(`/api/admin/notifications/${alertId2}/contacted`)
        .set('Cookie', studentCookie)
        .send({ method: 'whatsapp' });
      expect(forbidden.status).toBe(403);

      const disabled = await request(app)
        .patch(`/api/admin/notifications/${alertId2}/contacted`)
        .set('Cookie', adminCookie)
        .send({ method: 'whatsapp' });
      expect(disabled.status).toBe(404);

      await Notification.updateOne({ _id: alertId2 }, { actionStatus: 'contacted' });
      const checkout = await request(app)
        .post('/api/me/checkout')
        .set('Cookie', studentCookie);
      expect(checkout.status).toBe(200);

      const resolved = await Notification.findById(alertId2);
      expect(resolved?.actionStatus).toBe('resolved');
      expect(resolved?.resolvedAt).toBeTruthy();
    });

    it('resolves overtime follow-up when an admin force-checks out', async () => {
      const seat = await Seat.findOne({ number: 11 });
      const session = await Session.create({
        student: student2Id,
        seat: seat!._id,
        shiftHours: 12,
        checkInAt: new Date(Date.now() - 13 * 60 * 60 * 1000),
        shiftEndsAt: new Date(Date.now() - 20 * 60 * 1000),
        status: 'active',
      });
      const alert = await Notification.create({
        user: adminUserId,
        type: 'overtime_admin',
        channel: 'inapp',
        status: 'sent',
        message: 'Test overtime alert',
        sessionId: session._id,
        actionStatus: 'open',
        studentNameSnapshot: 'Student Two',
        studentPhoneSnapshot: testStudent2Phone,
      });

      const forceCheckout = await request(app)
        .post(`/api/admin/sessions/${session._id}/force-checkout`)
        .set('Cookie', adminCookie);
      expect(forceCheckout.status).toBe(200);

      const resolved = await Notification.findById(alert._id);
      expect(resolved?.actionStatus).toBe('resolved');
      expect(resolved?.resolvedAt).toBeTruthy();
    });

    it('PATCH /api/admin/notifications/:id/read marks single alert as read', async () => {
      const res = await request(app)
        .patch(`/api/admin/notifications/${alertId1}/read`)
        .set('Cookie', adminCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.data.read).toBe(true);
      expect(res.body.data.readAt).toBeTruthy();

      // The failed delivery alert was marked as read; the overtime alert remains unread.
      const countRes = await request(app)
        .get('/api/admin/notifications/unread-count')
        .set('Cookie', adminCookie);
      expect(countRes.body.count).toBe(1);
    });

    it('POST /api/admin/notifications/read-all marks all unread alerts as read', async () => {
      const res = await request(app)
        .post('/api/admin/notifications/read-all')
        .set('Cookie', adminCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);

      // Unread count should now be 0
      const countRes = await request(app)
        .get('/api/admin/notifications/unread-count')
        .set('Cookie', adminCookie);
      expect(countRes.body.count).toBe(0);
    });
  });

  // ─── SECTION 8: Soft Delete Students (Task C) ──────────────────────────────
  describe('Section 8: Soft Delete Students (Task C)', () => {
    let studentIdToDelete: string;
    let studentPhone: string;
    let studentPin: string;
    let seatId: string;

    beforeAll(async () => {
      studentPin = '123456';

      await User.syncIndexes();

      [studentPhone] = await createUniqueTestPhones(1);
      softDeleteTestPhone = studentPhone;

      // Find an available seat
      const seat = await Seat.findOne({ number: 50 });
      if (!seat) throw new Error('Test seat 50 was not seeded.');
      seatId = seat._id.toString();

      // Create student
      const pinHash = await bcrypt.hash(studentPin, 10);
      const student = await User.create({
        name: 'Soft Delete Test Student',
        phone: studentPhone,
        email: `${studentPhone}@example.test`,
        seatNumber: 50,
        shiftHours: 4,
        pinHash,
        role: 'student',
        status: 'approved',
        monthlyFee: 500,
      });
      studentIdToDelete = student._id.toString();
      testUserIds.push(student._id);

      // Enqueue a queued notification for this student
      await Notification.create({
        user: student._id,
        type: 'shift_reminder',
        channel: 'whatsapp',
        status: 'queued',
        message: 'Test queued shift reminder',
        studentNameSnapshot: student.name,
        studentPhoneSnapshot: student.phone,
      });
    });

    it('rejects deletion of admin accounts with 403', async () => {
      const res = await request(app)
        .delete(`/api/admin/students/${adminUserId}`)
        .set('Cookie', adminCookie);

      expect(res.status).toBe(403);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toContain('Admin users cannot be deleted');
    });

    it('rejects deletion with 409 when student has an active session', async () => {
      // Create an active session for the student
      const session = await Session.create({
        student: studentIdToDelete,
        seat: seatId,
        shiftHours: 4,
        checkInAt: new Date(),
        shiftEndsAt: new Date(Date.now() + 4 * 3600000),
        status: 'active',
      });

      const res = await request(app)
        .delete(`/api/admin/students/${studentIdToDelete}`)
        .set('Cookie', adminCookie);

      expect(res.status).toBe(409);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe('Cannot delete student with an active session. Please force check-out first.');

      // Complete the active session
      await Session.findByIdAndUpdate(session._id, {
        status: 'completed',
        checkOutAt: new Date(),
        checkoutType: 'manual',
      });
    });

    it('successfully soft-deletes student when no active session exists', async () => {
      const res = await request(app)
        .delete(`/api/admin/students/${studentIdToDelete}`)
        .set('Cookie', adminCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Student deleted successfully.');

      // Verify DB record
      const dbUser = await User.findById(studentIdToDelete);
      expect(dbUser).toBeTruthy();
      expect(dbUser!.isDeleted).toBe(true);
      expect(dbUser!.deletedAt).toBeTruthy();
      expect(dbUser!.status).toBe('rejected');

      // Verify queued notifications were deleted
      const queuedNotes = await Notification.find({ user: studentIdToDelete, status: 'queued' });
      expect(queuedNotes.length).toBe(0);
    });

    it('rejects re-deletion of already deleted student with 400', async () => {
      const res = await request(app)
        .delete(`/api/admin/students/${studentIdToDelete}`)
        .set('Cookie', adminCookie);

      expect(res.status).toBe(400);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe('Student is already deleted.');
    });

    it('prevents deleted student from logging in (returns 401 generic error)', async () => {
      const res = await request(app)
        .post('/api/auth/login')
        .send({ phone: studentPhone, pin: studentPin });

      expect(res.status).toBe(401);
      expect(res.body.success).toBe(false);
      expect(res.body.message).toBe('Phone or PIN is wrong.');
    });

    it('excludes soft-deleted student from GET /api/admin/students', async () => {
      const res = await request(app)
        .get('/api/admin/students')
        .set('Cookie', adminCookie);

      expect(res.status).toBe(200);
      const ids = res.body.data.map((u: { _id: string }) => u._id);
      expect(ids).not.toContain(studentIdToDelete);
    });

    it('allows a new student to register with the same phone number (partial unique index)', async () => {
      const res = await request(app)
        .post('/api/auth/register')
        .send({
          name: 'Replacement Student',
          phone: studentPhone,
          email: `${studentPhone}@replacement.example.test`,
          pin: '654321',
          seatNumber: 51,
          shiftHours: 12,
        });

      expect(res.status).toBe(201);
      expect(res.body.success).toBe(true);
      expect(res.body.data.phone).toBe(studentPhone);
    });
  });
});
