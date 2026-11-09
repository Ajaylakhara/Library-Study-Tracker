import dns from 'dns';
import path from 'path';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { getMongoHost, checkUnencodedPassword } from '../config';

// Load .env explicitly
dotenv.config();
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Configure Google DNS fallback to resolve Atlas SRV records
dns.setServers(['8.8.8.8', '8.8.4.4']);

async function testDatabaseConnection(): Promise<void> {
  const uri = (process.env.MONGODB_URI || process.env.MONGO_URI || '').trim();

  console.log('\n--- MongoDB Connection Diagnostic Tool ---');

  if (!uri) {
    console.error('\n[ERROR] Missing MongoDB URI.');
    console.error('Hint: Define MONGODB_URI (or MONGO_URI) in your backend/.env file.\n');
    process.exit(1);
  }

  const host = getMongoHost(uri);
  console.log(`Target Host: ${host}`);

  // Check for unencoded special characters in the password
  const unencodedChar = checkUnencodedPassword(uri);
  if (unencodedChar) {
    console.warn(`\n[WARNING] Unencoded special character detected in password: '${unencodedChar}'`);
    console.warn('Hint: Special characters like @, #, /, :, ?, % must be URL-encoded in connection strings.');
    console.warn('Action: Either URL-encode the character (e.g. ? -> %3F) or reset your Atlas database password to letters and numbers only.\n');
  }

  try {
    console.log('Connecting to MongoDB (timeout: 10s)...');
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 10000,
    });

    console.log(`\n[SUCCESS] Connected to host: ${host}`);
    console.log('Database connection is healthy and working properly.\n');

    await mongoose.disconnect();
    process.exit(0);
  } catch (err: unknown) {
    console.error('\n[CONNECTION FAILED]');

    const error = err as { name?: string; message?: string; code?: number };
    const errMsg = error.message || String(err);
    const errCode = error.code;

    if (
      errCode === 8000 ||
      /bad auth|authentication failed/i.test(errMsg)
    ) {
      console.error('Error Category: Authentication Failure (code 8000 / bad auth)');
      console.error('Hint: Wrong username or password in the URI, or the password contains special characters that must be URL-encoded.');
      console.error('Action in Atlas: In Database Access, confirm the exact username or reset the password to letters and numbers only.');
    } else if (
      /querySrv|ECONNREFUSED|ENOTFOUND/i.test(errMsg)
    ) {
      console.error('Error Category: DNS / SRV Lookup Failure');
      console.error('Hint: DNS problem; your ISP/router blocked MongoDB SRV query. Try setting Google DNS (8.8.8.8) or use the non-SRV standard connection string from MongoDB Atlas.');
    } else if (
      /ReplicaSetNoPrimary|server selection timed out|Could not connect to any servers/i.test(errMsg)
    ) {
      console.error('Error Category: Network / Firewall Timeout');
      console.error('Hint: IP address not allowed in Atlas Network Access.');
      console.error('Action in Atlas: Go to Security -> Network Access -> Add IP Address -> Allow Access from Anywhere (0.0.0.0/0 for local testing).');
    } else {
      console.error(`Error Category: ${error.name || 'ConnectionError'}`);
      console.error(`Message: ${errMsg}`);
    }

    console.log('');
    try {
      await mongoose.disconnect();
    } catch {
      // ignore
    }
    process.exit(1);
  }
}

testDatabaseConnection();
