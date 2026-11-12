import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import request from 'supertest';
import mongoose from 'mongoose';
import { randomInt } from 'crypto';
import bcrypt from 'bcryptjs';
import app from '../src/app';
import { config } from '../src/config';
import { LibrarySettings } from '../src/models/LibrarySettings';
import { User } from '../src/models/User';

describe('Library branding settings', () => {
  let adminCookie: string;
  let studentCookie: string;
  let adminPhone: string;
  let studentPhone: string;
  const pin = '741852';
  const pngDataUrl = `data:image/png;base64,${Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]).toString('base64')}`;

  async function uniquePhone(): Promise<string> {
    let phone: string;
    do {
      phone = `9${randomInt(100000000, 1000000000)}`;
    } while (await User.exists({ phone }));
    return phone;
  }

  beforeAll(async () => {
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 15000 });
    }

    await LibrarySettings.deleteMany({ key: 'primary' });
    [adminPhone, studentPhone] = await Promise.all([uniquePhone(), uniquePhone()]);
    await User.create([
      {
        name: 'Branding Admin',
        phone: adminPhone,
        pinHash: await bcrypt.hash(pin, 12),
        role: 'admin',
        status: 'approved',
      },
      {
        name: 'Branding Student',
        phone: studentPhone,
        pinHash: await bcrypt.hash(pin, 12),
        role: 'student',
        status: 'approved',
      },
    ]);

    const [adminLogin, studentLogin] = await Promise.all([
      request(app).post('/api/auth/login').send({ phone: adminPhone, pin }),
      request(app).post('/api/auth/login').send({ phone: studentPhone, pin }),
    ]);
    adminCookie = adminLogin.headers['set-cookie']?.[0] ?? '';
    studentCookie = studentLogin.headers['set-cookie']?.[0] ?? '';
  });

  afterAll(async () => {
    await LibrarySettings.deleteMany({ key: 'primary' });
    await User.deleteMany({ phone: { $in: [adminPhone, studentPhone] } });
    await mongoose.disconnect();
  });

  it('creates defaults on first public read and exposes only public branding fields', async () => {
    const response = await request(app).get('/api/settings/public');
    expect(response.status).toBe(200);
    expect(response.headers['cache-control']).toContain('max-age=60');
    expect(response.body.data).toMatchObject({
      libraryName: 'Library Study Tracker',
      shortName: 'LST',
      tagline: 'Learn · Focus · Grow',
      logo: null,
      favicon: null,
    });
    expect(response.body.data).toHaveProperty('updatedAt');
    expect(Object.keys(response.body.data).sort()).toEqual([
      'favicon',
      'libraryName',
      'logo',
      'shortName',
      'tagline',
      'updatedAt',
    ]);
    expect(response.body.data).not.toHaveProperty('contactPhone');
    expect(response.body.data).not.toHaveProperty('updatedBy');
    expect(await LibrarySettings.countDocuments({ key: 'primary' })).toBe(1);
  });

  it('does not allow a non-admin to update branding', async () => {
    const response = await request(app)
      .put('/api/admin/settings')
      .set('Cookie', studentCookie)
      .send({ libraryName: 'A New Library' });
    expect(response.status).toBe(403);
  });

  it('accepts a matching PNG signature and stores settings for the public endpoint', async () => {
    const response = await request(app)
      .put('/api/admin/settings')
      .set('Cookie', adminCookie)
      .send({
        libraryName: '  North Reading Room  ',
        shortName: 'NRR',
        tagline: 'A place to focus',
        contactPhone: '9876543210',
        logo: pngDataUrl,
      });

    expect(response.status).toBe(200);
    expect(response.body.data.libraryName).toBe('North Reading Room');
    const publicResponse = await request(app).get('/api/settings/public');
    expect(publicResponse.body.data.libraryName).toBe('North Reading Room');
    expect(publicResponse.body.data.logo).toBe(pngDataUrl);
  });

  it('rejects SVG, declared-type mismatches, and images over the logo limit', async () => {
    const svg = await request(app)
      .put('/api/admin/settings')
      .set('Cookie', adminCookie)
      .send({ logo: 'data:image/svg+xml;base64,PHN2Zz48L3N2Zz4=' });
    expect(svg.status).toBe(400);

    const mismatchedType = await request(app)
      .put('/api/admin/settings')
      .set('Cookie', adminCookie)
      .send({ logo: pngDataUrl.replace('image/png', 'image/jpeg') });
    expect(mismatchedType.status).toBe(400);
    expect(mismatchedType.body.message).toMatch(/does not match/i);

    const oversized = `data:image/png;base64,${Buffer.concat([
      Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
      Buffer.alloc(300 * 1024),
    ]).toString('base64')}`;
    const tooLarge = await request(app)
      .put('/api/admin/settings')
      .set('Cookie', adminCookie)
      .send({ logo: oversized });
    expect(tooLarge.status).toBe(413);
  });

  it('allows clearing a logo and rejects markup in names', async () => {
    const invalidName = await request(app)
      .put('/api/admin/settings')
      .set('Cookie', adminCookie)
      .send({ libraryName: '<b>Room</b>' });
    expect(invalidName.status).toBe(400);

    const cleared = await request(app)
      .put('/api/admin/settings')
      .set('Cookie', adminCookie)
      .send({ logo: null });
    expect(cleared.status).toBe(200);
    expect(cleared.body.data.logo).toBeNull();
  });
});
