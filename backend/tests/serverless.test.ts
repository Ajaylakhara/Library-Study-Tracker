import { afterAll, describe, expect, it, jest } from '@jest/globals';
import mongoose from 'mongoose';
import request from 'supertest';
import app from '../src/app';
import { connectDB, getDatabaseFailureReason } from '../src/db/connectDB';
import { errorHandler } from '../src/middleware/errorHandler';
import { Request, Response, NextFunction } from 'express';

describe('serverless database setup', () => {
  afterAll(async () => {
    await mongoose.disconnect();
    globalThis.mongooseConnectionPromise = undefined;
    globalThis.mongooseConnectionLogged = undefined;
  });

  it('does not connect to MongoDB for the basic health endpoint', async () => {
    const response = await request(app).get('/health');

    expect(response.status).toBe(200);
    expect(response.body.success).toBe(true);
    expect(mongoose.connection.readyState).toBe(0);
  });

  it('shares one connection promise and reuses the established connection', async () => {
    const connectSpy = jest.spyOn(mongoose, 'connect');
    const logSpy = jest.spyOn(console, 'log').mockImplementation(() => {});

    try {
      await Promise.all([connectDB(), connectDB()]);
      await connectDB();

      expect(connectSpy).toHaveBeenCalledTimes(1);
      expect(connectSpy.mock.calls[0]?.[1]).toEqual({
        serverSelectionTimeoutMS: 8000,
        bufferCommands: false,
      });
      expect(logSpy).toHaveBeenCalledTimes(1);
      expect(logSpy).toHaveBeenCalledWith(`MongoDB connected: ${mongoose.connection.name}`);
      expect(mongoose.connection.readyState).toBe(1);
    } finally {
      connectSpy.mockRestore();
      logSpy.mockRestore();
    }
  });

  it('connects before API routes and returns only a successful DB health result', async () => {
    const apiResponse = await request(app).get('/api/not-a-route');
    expect(apiResponse.status).toBe(404);
    expect(mongoose.connection.readyState).toBe(1);

    const response = await request(app).get('/health/db');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true });
  });
});

describe('database failure classification', () => {
  it.each([
    ['malformed URI', Object.assign(new Error('invalid URI'), { name: 'MongoParseError' }), 'uri'],
    ['authentication failure', Object.assign(new Error('authentication failed'), { code: 18 }), 'auth'],
    ['network failure', Object.assign(new Error('server selection timed out'), { name: 'MongooseServerSelectionError' }), 'network'],
    ['unknown failure', new Error('unexpected database error'), 'unknown'],
  ] as const)('classifies %s', (_label, error, reason) => {
    expect(getDatabaseFailureReason(error)).toBe(reason);
  });
});

describe('production error responses', () => {
  it('does not expose stack traces or internal paths', () => {
    const originalNodeEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'production';

    const res = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn(),
    } as unknown as Response;
    const error = Object.assign(new Error('Failure in C:\\internal\\src\\secret.ts'), {
      statusCode: 503,
    });
    error.stack = 'Error: internal stack at C:\\internal\\src\\secret.ts';

    try {
      errorHandler(error, {} as Request, res, jest.fn() as NextFunction);

      expect(res.status).toHaveBeenCalledWith(503);
      expect(res.json).toHaveBeenCalledWith({
        success: false,
        message: 'Something went wrong. Please try again.',
      });
    } finally {
      if (originalNodeEnv === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = originalNodeEnv;
    }
  });
});
