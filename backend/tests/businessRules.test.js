"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const globals_1 = require("@jest/globals");
const supertest_1 = __importDefault(require("supertest"));
const mongoose_1 = __importDefault(require("mongoose"));
const dns_1 = __importDefault(require("dns"));
const app_1 = __importDefault(require("../src/app"));
const User_1 = require("../src/models/User");
const Seat_1 = require("../src/models/Seat");
const Session_1 = require("../src/models/Session");
const Fee_1 = require("../src/models/Fee");
const config_1 = require("../src/config");
const shiftMonitor_1 = require("../src/jobs/shiftMonitor");
dns_1.default.setServers(['8.8.8.8', '8.8.4.4']);
(0, globals_1.describe)('Backend Business Rules & Integration Tests', () => {
    let adminCookie;
    let studentCookie;
    let student2Cookie;
    let studentId;
    let student2Id;
    let feeId;
    const testAdminPhone = '9999000001';
    const testStudentPhone = '9999000002';
    const testStudent2Phone = '9999000003';
    (0, globals_1.beforeAll)(async () => {
        if (mongoose_1.default.connection.readyState === 0) {
            await mongoose_1.default.connect(config_1.config.mongoUri, { serverSelectionTimeoutMS: 15000 });
        }
        // Clean up test users / sessions
        await User_1.User.deleteMany({ phone: { $in: [testAdminPhone, testStudentPhone, testStudent2Phone] } });
        await Seat_1.Seat.findOneAndUpdate({ number: 10 }, { number: 10, isActive: true }, { upsert: true });
        await Seat_1.Seat.findOneAndUpdate({ number: 11 }, { number: 11, isActive: true }, { upsert: true });
        // Seed test admin
        await (0, supertest_1.default)(app_1.default)
            .post('/api/auth/register')
            .send({
            name: 'Test Admin',
            phone: testAdminPhone,
            email: 'admin.test@example.com',
            pin: '123456',
            seatNumber: 10,
            shiftHours: 4,
        });
        // Make admin
        const adminUser = await User_1.User.findOneAndUpdate({ phone: testAdminPhone }, { role: 'admin', status: 'approved' }, { new: true });
        // Login as admin
        const adminRes = await (0, supertest_1.default)(app_1.default)
            .post('/api/auth/login')
            .send({ phone: testAdminPhone, pin: '123456' });
        adminCookie = adminRes.headers['set-cookie']?.[0] || '';
    });
    (0, globals_1.afterAll)(async () => {
        // Cleanup
        const testUsers = await User_1.User.find({ phone: { $in: [testAdminPhone, testStudentPhone, testStudent2Phone] } });
        const userIds = testUsers.map((u) => u._id);
        await Session_1.Session.deleteMany({ student: { $in: userIds } });
        await Fee_1.Fee.deleteMany({ student: { $in: userIds } });
        await User_1.User.deleteMany({ _id: { $in: userIds } });
        await mongoose_1.default.connection.close();
    });
    // ─── 1. Registration & Validation ──────────────────────────────────────────
    (0, globals_1.describe)('1. Registration and Validation', () => {
        (0, globals_1.it)('should reject registration if email, seatNumber, or shiftHours are invalid/missing', async () => {
            // Bad email
            const res1 = await (0, supertest_1.default)(app_1.default)
                .post('/api/auth/register')
                .send({
                name: 'Jane Doe',
                phone: testStudentPhone,
                email: 'invalid-email',
                pin: '123456',
                seatNumber: 10,
                shiftHours: 4,
            });
            (0, globals_1.expect)(res1.status).toBe(400);
            // Bad seat number (0 or >70)
            const res2 = await (0, supertest_1.default)(app_1.default)
                .post('/api/auth/register')
                .send({
                name: 'Jane Doe',
                phone: testStudentPhone,
                email: 'jane@example.com',
                pin: '123456',
                seatNumber: 71,
                shiftHours: 4,
            });
            (0, globals_1.expect)(res2.status).toBe(400);
            // Bad shift hours (not 4, 12, or 24)
            const res3 = await (0, supertest_1.default)(app_1.default)
                .post('/api/auth/register')
                .send({
                name: 'Jane Doe',
                phone: testStudentPhone,
                email: 'jane@example.com',
                pin: '123456',
                seatNumber: 10,
                shiftHours: 8,
            });
            (0, globals_1.expect)(res3.status).toBe(400);
            // Short PIN (less than 6 digits)
            const res4 = await (0, supertest_1.default)(app_1.default)
                .post('/api/auth/register')
                .send({
                name: 'Jane Doe',
                phone: testStudentPhone,
                email: 'jane@example.com',
                pin: '1234',
                seatNumber: 10,
                shiftHours: 4,
            });
            (0, globals_1.expect)(res4.status).toBe(400);
        });
        (0, globals_1.it)('should successfully register a student with email, seatNumber and shiftHours', async () => {
            const res = await (0, supertest_1.default)(app_1.default)
                .post('/api/auth/register')
                .send({
                name: 'Student One',
                phone: testStudentPhone,
                email: 'student1@example.com',
                pin: '123456',
                seatNumber: 10,
                shiftHours: 4,
            });
            (0, globals_1.expect)(res.status).toBe(201);
            (0, globals_1.expect)(res.body.success).toBe(true);
            (0, globals_1.expect)(res.body.data.email).toBe('student1@example.com');
            (0, globals_1.expect)(res.body.data.seatNumber).toBe(10);
            (0, globals_1.expect)(res.body.data.shiftHours).toBe(4);
            (0, globals_1.expect)(res.body.data.status).toBe('pending');
            studentId = res.body.data.id;
            // Register student 2 (sharing seat 10)
            const res2 = await (0, supertest_1.default)(app_1.default)
                .post('/api/auth/register')
                .send({
                name: 'Student Two',
                phone: testStudent2Phone,
                email: 'student2@example.com',
                pin: '123456',
                seatNumber: 10,
                shiftHours: 12,
            });
            (0, globals_1.expect)(res2.status).toBe(201);
            student2Id = res2.body.data.id;
            // Approve both students
            await User_1.User.findByIdAndUpdate(studentId, { status: 'approved' });
            await User_1.User.findByIdAndUpdate(student2Id, { status: 'approved' });
        });
    });
    // ─── 2. Login & Session ────────────────────────────────────────────────────
    (0, globals_1.describe)('2. Authentication & 401 handling', () => {
        (0, globals_1.it)('returns 401 with generic error on incorrect PIN', async () => {
            const res = await (0, supertest_1.default)(app_1.default)
                .post('/api/auth/login')
                .send({ phone: testStudentPhone, pin: '000000' });
            (0, globals_1.expect)(res.status).toBe(401);
            (0, globals_1.expect)(res.body.success).toBe(false);
            (0, globals_1.expect)(res.body.message).toMatch(/phone or pin is wrong/i);
        });
        (0, globals_1.it)('returns set-cookie on valid login', async () => {
            const res = await (0, supertest_1.default)(app_1.default)
                .post('/api/auth/login')
                .send({ phone: testStudentPhone, pin: '123456' });
            (0, globals_1.expect)(res.status).toBe(200);
            (0, globals_1.expect)(res.body.success).toBe(true);
            studentCookie = res.headers['set-cookie']?.[0] || '';
            (0, globals_1.expect)(studentCookie).toContain('token=');
            // Login student 2
            const res2 = await (0, supertest_1.default)(app_1.default)
                .post('/api/auth/login')
                .send({ phone: testStudent2Phone, pin: '123456' });
            student2Cookie = res2.headers['set-cookie']?.[0] || '';
        });
        (0, globals_1.it)('GET /api/auth/me returns seatNumber, shiftHours, and email from DB', async () => {
            const res = await (0, supertest_1.default)(app_1.default)
                .get('/api/auth/me')
                .set('Cookie', studentCookie);
            (0, globals_1.expect)(res.status).toBe(200);
            (0, globals_1.expect)(res.body.data.email).toBe('student1@example.com');
            (0, globals_1.expect)(res.body.data.seatNumber).toBe(10);
            (0, globals_1.expect)(res.body.data.shiftHours).toBe(4);
        });
    });
    // ─── 3. Check-In & Seat Occupancy ──────────────────────────────────────────
    (0, globals_1.describe)('3. Check-in logic (empty body & 409 conflict)', () => {
        (0, globals_1.it)('POST /me/checkin accepts empty body and checks in using profile seat and shift', async () => {
            const res = await (0, supertest_1.default)(app_1.default)
                .post('/api/me/checkin')
                .set('Cookie', studentCookie)
                .send({}); // EMPTY BODY
            (0, globals_1.expect)(res.status).toBe(201);
            (0, globals_1.expect)(res.body.success).toBe(true);
            (0, globals_1.expect)(res.body.data.seatNumber).toBe(10);
            (0, globals_1.expect)(res.body.data.shiftHours).toBe(4);
        });
        (0, globals_1.it)('POST /me/checkin ignores any client body params and still uses profile values', async () => {
            // Trying to check in again with spoofed seatId and shift
            const res = await (0, supertest_1.default)(app_1.default)
                .post('/api/me/checkin')
                .set('Cookie', studentCookie)
                .send({ seatId: 'spoofed_id', shiftHours: 24 });
            // Student is already checked in -> returns 409
            (0, globals_1.expect)(res.status).toBe(409);
            (0, globals_1.expect)(res.body.message).toMatch(/occupied or you are already checked in/i);
        });
        (0, globals_1.it)('returns 409 when student 2 tries to check in to seat 10 while student 1 is occupying it', async () => {
            const res = await (0, supertest_1.default)(app_1.default)
                .post('/api/me/checkin')
                .set('Cookie', student2Cookie)
                .send({});
            (0, globals_1.expect)(res.status).toBe(409);
            (0, globals_1.expect)(res.body.message).toMatch(/occupied or you are already checked in/i);
        });
    });
    // ─── 4. Admin Edits Profile While Session Is Active ────────────────────────
    (0, globals_1.describe)('4. Admin edits student seat/shift during active session', () => {
        (0, globals_1.it)('does NOT modify active session when admin edits student seatNumber and shiftHours', async () => {
            // Active session before edit
            const beforeSession = await Session_1.Session.findOne({ student: studentId, status: 'active' }).populate('seat');
            (0, globals_1.expect)((beforeSession?.seat).number).toBe(10);
            (0, globals_1.expect)(beforeSession?.shiftHours).toBe(4);
            // Admin updates student 1 to seat 11, 12h shift
            const adminEditRes = await (0, supertest_1.default)(app_1.default)
                .patch(`/api/admin/students/${studentId}`)
                .set('Cookie', adminCookie)
                .send({
                seatNumber: 11,
                shiftHours: 12,
            });
            (0, globals_1.expect)(adminEditRes.status).toBe(200);
            (0, globals_1.expect)(adminEditRes.body.data.seatNumber).toBe(11);
            (0, globals_1.expect)(adminEditRes.body.data.shiftHours).toBe(12);
            // Check active session again: MUST REMAIN UNMODIFIED (seat 10, 4h shift)
            const afterSession = await Session_1.Session.findOne({ student: studentId, status: 'active' }).populate('seat');
            (0, globals_1.expect)((afterSession?.seat).number).toBe(10);
            (0, globals_1.expect)(afterSession?.shiftHours).toBe(4);
            (0, globals_1.expect)(afterSession?._id.toString()).toBe(beforeSession?._id.toString());
        });
    });
    // ─── 5. Overtime & No Auto Check-Out ────────────────────────────────────────
    (0, globals_1.describe)('5. Shift monitor & No auto check-out', () => {
        (0, globals_1.it)('leaves session active even 45 minutes past shiftEnd (no auto check-out)', async () => {
            // Move session shiftEndsAt to 45 minutes in the past
            const pastDate = new Date(Date.now() - 45 * 60 * 1000);
            await Session_1.Session.findOneAndUpdate({ student: studentId, status: 'active' }, { shiftEndsAt: pastDate });
            // Run shift monitor
            await (0, shiftMonitor_1.runShiftMonitor)();
            // Verify session is STILL active
            const session = await Session_1.Session.findOne({ student: studentId, status: 'active' });
            (0, globals_1.expect)(session).not.toBeNull();
            (0, globals_1.expect)(session?.status).toBe('active');
            (0, globals_1.expect)(session?.checkoutType).toBeNull();
        });
        (0, globals_1.it)('student manually checks out cleanly from overtime', async () => {
            const res = await (0, supertest_1.default)(app_1.default)
                .post('/api/me/checkout')
                .set('Cookie', studentCookie);
            (0, globals_1.expect)(res.status).toBe(200);
            (0, globals_1.expect)(res.body.success).toBe(true);
            const session = await Session_1.Session.findOne({ student: studentId, status: 'active' });
            (0, globals_1.expect)(session).toBeNull();
        });
    });
    // ─── 6. Fees with Optional Note ────────────────────────────────────────────
    (0, globals_1.describe)('6. Fees and markFeePaid with note only', () => {
        (0, globals_1.it)('marks fee as paid with an optional note', async () => {
            const fee = await Fee_1.Fee.create({
                student: studentId,
                month: '2026-10',
                amount: 1000,
                status: 'unpaid',
            });
            feeId = fee._id.toString();
            const res = await (0, supertest_1.default)(app_1.default)
                .patch(`/api/admin/fees/${feeId}/pay`)
                .set('Cookie', adminCookie)
                .send({ note: 'Paid in cash at library desk' });
            (0, globals_1.expect)(res.status).toBe(200);
            (0, globals_1.expect)(res.body.data.status).toBe('paid');
            (0, globals_1.expect)(res.body.data.note).toBe('Paid in cash at library desk');
        });
    });
});
//# sourceMappingURL=businessRules.test.js.map