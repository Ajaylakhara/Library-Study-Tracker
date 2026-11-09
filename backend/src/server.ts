import dns from 'dns';
import mongoose from 'mongoose';
import app from './app';
import { config, getMongoHost, checkUnencodedPassword } from './config';
import { connectDB, getDatabaseFailureReason } from './db/connectDB';
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
    await connectDB();

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

    const reason = getDatabaseFailureReason(err);
    if (reason === 'auth') {
      console.error('[Reason] Authentication failure (code 8000 / bad auth).');
      console.error('[Action] 1. Verify your database username in Atlas (Database Access).');
      console.error('[Action] 2. Reset password to alphanumeric only (or URL-encode special characters).');
    } else if (reason === 'network') {
      console.error('[Reason] Network failure / server selection timed out.');
      console.error('[Action] Check MongoDB Atlas network access and DNS connectivity.');
    } else if (reason === 'uri') {
      console.error('[Reason] Invalid MongoDB connection URI.');
    } else {
      const error = err as { name?: string };
      console.error(`[Reason] ${error.name || 'Error'}`);
    }
    console.error('======================================================\n');
    process.exit(1);
  }
}

if (process.env.VERCEL === undefined) {
  bootstrap();
}

export default app;
