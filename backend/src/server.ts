import dns from 'dns';
import mongoose from 'mongoose';
import app from './app';
import { config, getMongoHost, checkUnencodedPassword } from './config';
import { startJobs } from './jobs';

// Ensure SRV records for mongodb+srv resolve even on restrictive ISP DNS
dns.setServers(['8.8.8.8', '8.8.4.4']);

async function bootstrap(): Promise<void> {
  const host = getMongoHost(config.mongoUri);

  // Warn if unencoded password characters exist
  const unencodedChar = checkUnencodedPassword(config.mongoUri);
  if (unencodedChar) {
    console.warn(`[DB Warning] Detected unencoded special character '${unencodedChar}' in database password.`);
    console.warn('[DB Warning] If authentication fails, URL-encode special characters or use letters and numbers only in Atlas.');
  }

  try {
    await mongoose.connect(config.mongoUri, {
      serverSelectionTimeoutMS: 10000,
    });
    console.log(`[DB] Connected to MongoDB host: ${host}`);

    // Ensure all indexes are created
    await mongoose.connection.syncIndexes();

    // Start background jobs
    startJobs();

    const server = app.listen(config.port, () => {
      console.log(`[Server] Running on http://localhost:${config.port} (${config.nodeEnv})`);
    });

    // Graceful shutdown
    const shutdown = async (signal: string) => {
      console.log(`\n[Server] ${signal} received. Shutting down...`);
      server.close(async () => {
        await mongoose.connection.close();
        console.log('[Server] Graceful shutdown complete.');
        process.exit(0);
      });
    };

    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
  } catch (err: unknown) {
    console.error('\n======================================================');
    console.error('[Server] Bootstrap failed: Could not connect to MongoDB');
    console.error(`[Server] Target Host: ${host}`);

    const error = err as { name?: string; message?: string; code?: number };
    const errMsg = error.message || String(err);
    const errCode = error.code;

    if (errCode === 8000 || /bad auth|authentication failed/i.test(errMsg)) {
      console.error('[Reason] Authentication failure (code 8000 / bad auth).');
      console.error('[Action] 1. Verify your database username in Atlas (Database Access).');
      console.error('[Action] 2. Reset password to alphanumeric only (or URL-encode special characters).');
    } else if (/querySrv|ECONNREFUSED|ENOTFOUND/i.test(errMsg)) {
      console.error('[Reason] DNS SRV query failure.');
      console.error('[Action] Your network blocked SRV records. Google DNS (8.8.8.8) is configured, or use the standard non-SRV connection string.');
    } else if (/ReplicaSetNoPrimary|server selection timed out|Could not connect to any servers/i.test(errMsg)) {
      console.error('[Reason] Cluster unreachable / Server selection timed out.');
      console.error('[Action] Whitelist your IP in MongoDB Atlas (Network Access -> Allow Access from Anywhere: 0.0.0.0/0).');
    } else {
      console.error(`[Reason] ${error.name || 'Error'}: ${errMsg}`);
    }
    console.error('======================================================\n');
    process.exit(1);
  }
}

bootstrap();
