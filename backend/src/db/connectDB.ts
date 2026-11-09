import mongoose from 'mongoose';
import { config } from '../config';

declare global {
  // eslint-disable-next-line no-var
  var mongooseConnectionPromise: Promise<void> | undefined;
  // eslint-disable-next-line no-var
  var mongooseConnectionLogged: boolean | undefined;
}

mongoose.set('bufferCommands', false);

export type DatabaseFailureReason = 'network' | 'auth' | 'uri' | 'unknown';

function isValidMongoUri(uri: string): boolean {
  try {
    const parsed = new URL(uri);
    return (
      ['mongodb:', 'mongodb+srv:'].includes(parsed.protocol) &&
      parsed.hostname.length > 0
    );
  } catch {
    return false;
  }
}

export function getDatabaseFailureReason(error: unknown): DatabaseFailureReason {
  const err = error as { name?: string; message?: string; code?: number };
  const name = err?.name ?? '';
  const message = err?.message ?? '';

  if (/MongoParseError|MongoInvalidArgumentError/.test(name)) return 'uri';
  if (err?.code === 18 || err?.code === 8000 || /bad auth|authentication failed/i.test(message)) {
    return 'auth';
  }
  if (
    /MongoNetworkError|MongooseServerSelectionError/.test(name) ||
    /ECONN|ENOTFOUND|querySrv|network|timed out|server selection|ReplicaSetNoPrimary/i.test(
      message
    )
  ) {
    return 'network';
  }

  return 'unknown';
}

export async function connectDB(): Promise<void> {
  if (mongoose.connection.readyState === 1) return;
  if (globalThis.mongooseConnectionPromise && mongoose.connection.readyState === 2) {
    return globalThis.mongooseConnectionPromise;
  }
  if (mongoose.connection.readyState === 0) {
    globalThis.mongooseConnectionPromise = undefined;
  }

  const connectionPromise = (async () => {
    if (!isValidMongoUri(config.mongoUri)) {
      const error = new Error('Invalid MongoDB connection URI.');
      error.name = 'MongoParseError';
      throw error;
    }

    await mongoose.connect(config.mongoUri, {
      serverSelectionTimeoutMS: 8000,
      bufferCommands: false,
    });

    if (!globalThis.mongooseConnectionLogged) {
      console.log(`MongoDB connected: ${mongoose.connection.name}`);
      globalThis.mongooseConnectionLogged = true;
    }
  })();

  globalThis.mongooseConnectionPromise = connectionPromise;
  try {
    await connectionPromise;
  } catch (error) {
    if (globalThis.mongooseConnectionPromise === connectionPromise) {
      globalThis.mongooseConnectionPromise = undefined;
    }
    throw error;
  }
}
