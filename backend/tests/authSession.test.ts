import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import mongoose from 'mongoose';
import request from 'supertest';

// Login attempts below would otherwise trip the per-IP express limiter before the lockout logic.
process.env.AUTH_RATE_LIMIT_MAX = '1000';

// eslint-disable-next-line @typescript-eslint/no-var-requires
const app = require('../src/app').default as import('express').Express;
import { config } from '../src/config';
import { LoginThrottle } from '../src/models/LoginThrottle';
import { User } from '../src/models/User';
import { THROTTLE_MESSAGE } from '../src/services/loginThrottle';

/**
 * Needs the MongoDB test database (MONGODB_TEST_URI), like the other integration tests.
 */
describe('login, session cookie and lockout', () => {
  const suffix = String(Date.now()).slice(-7);
  const PIN = '482916';
  const phones = {
    student: `91${suffix}1`.slice(0, 10).padEnd(10, '1'),
    blocked: `91${suffix}2`.slice(0, 10).padEnd(10, '2'),
    admin: `91${suffix}3`.slice(0, 10).padEnd(10, '3'),
    unknown: `91${suffix}4`.slice(0, 10).padEnd(10, '4'),
  };
  let student: InstanceType<typeof User>;
  let blocked: InstanceType<typeof User>;
  let admin: InstanceType<typeof User>;

  const cookieFor = (userId: string, role: string, expiresIn: number | string) =>
    `token=${jwt.sign({ userId, role, tokenVersion: 0 }, config.jwt.secret, { expiresIn: expiresIn as number })}`;
  const setCookies = (res: request.Response): string[] => {
    const header = res.headers['set-cookie'] as unknown;
    return Array.isArray(header) ? (header as string[]) : header ? [String(header)] : [];
  };
  const login = (phone: string, pin: string) => request(app).post('/api/auth/login').send({ phone, pin });

  beforeAll(async () => {
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 15000 });
    }
    const pinHash = await bcrypt.hash(PIN, 4);
    student = await User.create({ name: 'Session Student', phone: phones.student, pinHash, role: 'student', status: 'approved' });
    blocked = await User.create({ name: 'Blocked Student', phone: phones.blocked, pinHash, role: 'student', status: 'blocked' });
    admin = await User.create({ name: 'Session Admin', phone: phones.admin, pinHash, role: 'admin', status: 'approved' });
  });

  afterAll(async () => {
    await User.deleteMany({ _id: { $in: [student?._id, blocked?._id, admin?._id] } });
    await LoginThrottle.deleteMany({
      $or: [{ key: { $in: Object.values(phones).map((p) => `phone:${p}`) } }, { key: /^ip:/ }],
    });
  });

  it('sets an httpOnly, lax, 30-day cookie on login', async () => {
    const res = await login(phones.student, PIN);
    expect(res.status).toBe(200);
    const cookie = setCookies(res).find((c) => c.startsWith('token='));
    expect(cookie).toBeDefined();
    expect(cookie).toMatch(/HttpOnly/i);
    expect(cookie).toMatch(/SameSite=Lax/i);
    expect(cookie).toMatch(/Path=\//i);
    expect(cookie).toMatch(/Max-Age=2592000/);
    expect(/Secure/i.test(cookie!)).toBe(config.isProduction);
    await LoginThrottle.deleteMany({ key: /^ip:/ });
  });

  it('issues a fresh cookie when the token has less than 15 days left', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', cookieFor(student._id.toString(), 'student', 10 * 24 * 60 * 60));
    expect(res.status).toBe(200);
    const renewed = setCookies(res).find((c) => c.startsWith('token='));
    expect(renewed).toBeDefined();
    expect(renewed).toMatch(/Max-Age=2592000/);
  });

  it('keeps the same cookie when the token has plenty of time left', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', cookieFor(student._id.toString(), 'student', 25 * 24 * 60 * 60));
    expect(res.status).toBe(200);
    expect(setCookies(res).some((c) => c.startsWith('token='))).toBe(false);
  });

  it('rejects an expired token', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', cookieFor(student._id.toString(), 'student', -60));
    expect(res.status).toBe(401);
  });

  it('rejects a tampered token', async () => {
    const good = cookieFor(student._id.toString(), 'student', '25d');
    const res = await request(app).get('/api/auth/me').set('Cookie', `${good.slice(0, -3)}abc`);
    expect(res.status).toBe(401);
  });

  it('refuses a valid token once the account is blocked', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Cookie', cookieFor(blocked._id.toString(), 'student', '25d'));
    expect(res.status).toBe(403);
  });

  it('locks an account after 5 wrong PINs, even for the correct PIN, with a generic message', async () => {
    for (let i = 0; i < 5; i++) {
      const wrong = await login(phones.student, '000000');
      expect(wrong.status).toBe(401);
    }
    const locked = await login(phones.student, PIN);
    expect(locked.status).toBe(429);
    expect(locked.body.message).toBe(THROTTLE_MESSAGE);
    await LoginThrottle.deleteMany({ key: /^ip:/ });
  });

  it('applies the same lockout to admins', async () => {
    for (let i = 0; i < 5; i++) await login(phones.admin, '000000');
    const locked = await login(phones.admin, PIN);
    expect(locked.status).toBe(429);
    expect(locked.body.message).toBe(THROTTLE_MESSAGE);
    await LoginThrottle.deleteMany({ key: /^ip:/ });
  });

  it('gives an unknown phone the same answers as a real one, so it reveals nothing', async () => {
    const first = await login(phones.unknown, '111111');
    expect(first.status).toBe(401);
    expect(first.body.message).toBe('Phone or PIN is wrong.');
    for (let i = 0; i < 4; i++) await login(phones.unknown, '111111');
    const locked = await login(phones.unknown, '111111');
    expect(locked.status).toBe(429);
    expect(locked.body.message).toBe(THROTTLE_MESSAGE);
  });
});
