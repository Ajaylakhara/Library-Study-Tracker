import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import request from 'supertest';
import mongoose from 'mongoose';
import app from '../src/app';
import { config } from '../src/config';
import { JobLock } from '../src/models/JobLock';

describe('serverless cron endpoints', () => {
  const previousSecret = process.env.CRON_SECRET;

  beforeAll(async () => {
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 15000 });
    }
    await JobLock.init();
    await JobLock.deleteMany({ name: { $in: ['shift-monitor', 'notification-worker', 'tick'] } });
  });

  afterAll(async () => {
    await JobLock.deleteMany({ name: { $in: ['shift-monitor', 'notification-worker', 'tick'] } });
    if (previousSecret === undefined) delete process.env.CRON_SECRET;
    else process.env.CRON_SECRET = previousSecret;
  });

  it('refuses to run when CRON_SECRET is unset', async () => {
    delete process.env.CRON_SECRET;
    const response = await request(app).get('/api/cron/shift-monitor');
    expect(response.status).toBe(503);
    expect(response.body).toMatchObject({ ok: false });
  });

  it('rejects requests with a missing or incorrect secret', async () => {
    process.env.CRON_SECRET = 'test-cron-secret-that-is-never-a-production-credential';
    const [missing, incorrect] = await Promise.all([
      request(app).post('/api/cron/notification-worker'),
      request(app)
        .post('/api/cron/notification-worker')
        .set('Authorization', 'Bearer incorrect-secret'),
    ]);
    expect(missing.status).toBe(401);
    expect(incorrect.status).toBe(401);
  });

  it('skips a job while its MongoDB lock is active', async () => {
    process.env.CRON_SECRET = 'test-cron-secret-that-is-never-a-production-credential';
    await JobLock.create({
      name: 'shift-monitor',
      lockedUntil: new Date(Date.now() + 60_000),
    });

    const response = await request(app)
      .post('/api/cron/shift-monitor')
      .set('x-cron-secret', process.env.CRON_SECRET!);

    expect(response.status).toBe(200);
    expect(response.body).toMatchObject({
      ok: true,
      skipped: true,
      processed: 0,
    });
  });
});
