import path from 'path';
import dotenv from 'dotenv';
import dns from 'dns';
import mongoose from 'mongoose';
import { User } from '../models/User';

// Load .env explicitly
dotenv.config();
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

// Configure Google DNS fallback to resolve Atlas SRV records
dns.setServers(['8.8.8.8', '8.8.4.4']);

export async function migrateSoftDelete(): Promise<void> {
  const uri = (process.env.MONGODB_URI || process.env.MONGO_URI || '').trim();

  if (!uri) {
    console.error('[MIGRATE] Error: Missing MONGODB_URI in environment.');
    process.exit(1);
  }

  console.log('[MIGRATE] Connecting to MongoDB...');
  await mongoose.connect(uri, { serverSelectionTimeoutMS: 10000 });
  console.log('[MIGRATE] Connected to MongoDB.');

  try {
    // 1. Backfill isDeleted: false and deletedAt: null where missing
    const backfillResult = await User.updateMany(
      { isDeleted: { $exists: false } },
      { $set: { isDeleted: false, deletedAt: null } }
    );
    console.log(`[MIGRATE] Backfilled isDeleted on ${backfillResult.modifiedCount} user document(s).`);

    // 2. Inspect existing indexes on users collection
    const collection = mongoose.connection.collection('users');
    const existingIndexes = await collection.indexes();
    console.log(`[MIGRATE] Existing indexes:`, existingIndexes.map((idx) => idx.name));

    // If an old non-partial phone_1 index exists, drop it to prevent duplicate key conflicts with soft-deleted users
    const oldPhoneIndex = existingIndexes.find(
      (idx) => idx.name === 'phone_1' && !idx.partialFilterExpression
    );
    if (oldPhoneIndex) {
      console.log('[MIGRATE] Dropping old global unique index "phone_1"...');
      await collection.dropIndex('phone_1');
      console.log('[MIGRATE] Old "phone_1" index dropped successfully.');
    }

    // 3. Sync indexes defined in User schema (including the partial unique phone index)
    console.log('[MIGRATE] Syncing User indexes...');
    await User.syncIndexes();
    console.log('[MIGRATE] User indexes synced successfully.');

    console.log('[MIGRATE] Migration completed successfully.');
  } catch (err) {
    console.error('[MIGRATE] Migration failed:', err);
    throw err;
  } finally {
    await mongoose.disconnect();
    console.log('[MIGRATE] Disconnected from MongoDB.');
  }
}

// Allow direct CLI execution: npx ts-node src/scripts/migrateSoftDelete.ts
if (require.main === module) {
  migrateSoftDelete()
    .then(() => process.exit(0))
    .catch(() => process.exit(1));
}
