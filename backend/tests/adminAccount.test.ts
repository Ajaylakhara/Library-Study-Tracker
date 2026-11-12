import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import request from 'supertest';
import mongoose from 'mongoose';
import { randomInt } from 'crypto';
import bcrypt from 'bcryptjs';
import app from '../src/app';
import { config } from '../src/config';
import { User } from '../src/models/User';

describe('Admin account security endpoints', () => {
  let adminCookie: string;
  let adminPhone: string;
  let duplicatePhone: string;
  let newPhone: string;
  const initialPin = '654321';
  const newPin = '482913';
  let previousTrustProxy: unknown;

  async function uniquePhone(): Promise<string> {
    let phone = '';
    do {
      phone = `9${randomInt(100000000, 1000000000)}`;
    } while (await User.exists({ phone }));
    return phone;
  }

  function withClientIp<T extends request.Test>(test: T, ip: string): T {
    return test.set('X-Forwarded-For', ip);
  }

  beforeAll(async () => {
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 15000 });
    }
    previousTrustProxy = app.get('trust proxy');
    app.set('trust proxy', 1);
    [adminPhone, duplicatePhone, newPhone] = await Promise.all([
      uniquePhone(),
      uniquePhone(),
      uniquePhone(),
    ]);

    await User.create([
      {
        name: 'Account Test Admin',
        phone: adminPhone,
        pinHash: await bcrypt.hash(initialPin, 12),
        role: 'admin',
        status: 'approved',
      },
      {
        name: 'Account Test Student',
        phone: duplicatePhone,
        pinHash: await bcrypt.hash('741852', 12),
        role: 'student',
        status: 'approved',
      },
    ]);

    const login = await request(app).post('/api/auth/login').send({ phone: adminPhone, pin: initialPin });
    adminCookie = login.headers['set-cookie']?.[0] ?? '';
  });

  afterAll(async () => {
    app.set('trust proxy', previousTrustProxy);
    await User.deleteMany({ phone: { $in: [adminPhone, duplicatePhone, newPhone] } });
    await mongoose.disconnect();
  });

  it('requires the current PIN and rejects a phone used by another account', async () => {
    const wrongPin = await withClientIp(
      request(app).post('/api/admin/account/change-phone').set('Cookie', adminCookie),
      '203.0.113.31'
    ).send({ currentPin: '000000', phone: newPhone });
    expect(wrongPin.status).toBe(401);
    expect(wrongPin.body.message).toMatch(/current pin is incorrect/i);

    const duplicate = await withClientIp(
      request(app).post('/api/admin/account/change-phone').set('Cookie', adminCookie),
      '203.0.113.32'
    ).send({ currentPin: initialPin, phone: duplicatePhone });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.message).toMatch(/already used/i);
  });

  it('changes the phone after validating the current PIN', async () => {
    const response = await withClientIp(
      request(app).post('/api/admin/account/change-phone').set('Cookie', adminCookie),
      '203.0.113.33'
    ).send({ currentPin: initialPin, phone: newPhone });

    expect(response.status).toBe(200);
    expect(response.body.data.phone).toBe(newPhone);
    expect(await User.exists({ phone: newPhone, role: 'admin' })).toBeTruthy();
  });

  it('rejects trivial PINs and invalidates the previous admin session after a valid PIN change', async () => {
    const trivial = await withClientIp(
      request(app).post('/api/admin/account/change-pin').set('Cookie', adminCookie),
      '203.0.113.34'
    ).send({ currentPin: initialPin, newPin: '123456' });
    expect(trivial.status).toBe(400);

    const changed = await withClientIp(
      request(app).post('/api/admin/account/change-pin').set('Cookie', adminCookie),
      '203.0.113.35'
    ).send({ currentPin: initialPin, newPin });
    expect(changed.status).toBe(200);

    const oldSession = await request(app).get('/api/admin/notifications').set('Cookie', adminCookie);
    expect(oldSession.status).toBe(401);

    const newLogin = await request(app).post('/api/auth/login').send({ phone: newPhone, pin: newPin });
    expect(newLogin.status).toBe(200);
    expect(newLogin.body.data.role).toBe('admin');
  });

  it('rate limits repeated account changes', async () => {
    const login = await request(app).post('/api/auth/login').send({ phone: newPhone, pin: newPin });
    const cookie = login.headers['set-cookie']?.[0] ?? '';

    for (let attempt = 0; attempt < 5; attempt += 1) {
      const response = await withClientIp(
        request(app).post('/api/admin/account/change-phone').set('Cookie', cookie),
        '203.0.113.36'
      ).send({ currentPin: '000000', phone: newPhone });
      expect(response.status).toBe(401);
    }

    const limited = await withClientIp(
      request(app).post('/api/admin/account/change-phone').set('Cookie', cookie),
      '203.0.113.36'
    ).send({ currentPin: '000000', phone: newPhone });
    expect(limited.status).toBe(429);
  });
});
