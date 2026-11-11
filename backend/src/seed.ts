import dns from 'dns';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { config, getMongoHost } from './config';

dns.setServers(['8.8.8.8', '8.8.4.4']);

async function seed(): Promise<void> {
  try {
    if (!/^\d{10}$/.test(config.seed.adminPhone)) {
      throw new Error('ADMIN_PHONE must be a 10-digit phone number.');
    }
    if (!/^\d{6}$/.test(config.seed.adminPin)) {
      throw new Error('Set ADMIN_PIN to a six-digit value before running the seed.');
    }

    await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 10000 });
    console.log(`[Seed] Connected to MongoDB host: ${getMongoHost(config.mongoUri)}`);

    // Dynamically import models
    const { User } = await import('./models/User');
    const { ensureSeats, TOTAL_SEATS } = await import('./models/Seat');

    await mongoose.connection.syncIndexes();

    // ─── 1. Seed Seats (1 to 70) ─────────────────────────────────────────────
    console.log(`[Seed] Ensuring seats 1-${TOTAL_SEATS} exist...`);
    await ensureSeats();
    console.log('[Seed] Seats ensured; existing active settings were preserved.');

    // ─── 2. Seed Admin ────────────────────────────────────────────────────────
    const adminPhone = config.seed.adminPhone;
    const pinHash = await bcrypt.hash(config.seed.adminPin, 12);
    const existingAdmin = await User.findOne({
      role: 'admin',
      $or: [
        { phone: adminPhone },
        ...(config.seed.adminEmail ? [{ email: config.seed.adminEmail.toLowerCase().trim() }] : []),
      ],
    });
    if (existingAdmin) {
      existingAdmin.name = config.seed.adminName || 'Librarian';
      existingAdmin.phone = adminPhone;
      existingAdmin.email = config.seed.adminEmail.toLowerCase().trim() || undefined;
      existingAdmin.pinHash = pinHash;
      existingAdmin.status = 'approved';
      existingAdmin.failedAttempts = 0;
      existingAdmin.lockedUntil = null;
      await existingAdmin.save();
      console.log(`[Seed] Admin updated for phone ending ${adminPhone.slice(-4)}.`);
    } else {
      await User.create({
        name: config.seed.adminName || 'Librarian',
        phone: adminPhone,
        ...(config.seed.adminEmail && { email: config.seed.adminEmail.toLowerCase().trim() }),
        pinHash,
        role: 'admin',
        status: 'approved',
        monthlyFee: 0,
        failedAttempts: 0,
      });
      console.log(`[Seed] Admin created for phone ending ${adminPhone.slice(-4)}.`);
    }

    // ─── 3. Backfill Legacy Students Without Required Fields ──────────────────
    const legacyCount = await User.countDocuments({
      role: 'student',
      $or: [{ seatNumber: { $exists: false } }, { shiftHours: { $exists: false } }],
    });

    if (legacyCount > 0) {
      console.log(`[Seed] Found ${legacyCount} legacy student(s) missing registration-era seat/shift values. Removing obsolete fields...`);
      await User.updateMany(
        {
          role: 'student',
          $or: [{ seatNumber: { $exists: true } }, { shiftHours: { $exists: true } }],
        },
        { $unset: { seatNumber: 1, shiftHours: 1, email: 1 } }
      );
      console.log('[Seed] Obsolete student seat, shift, and email fields removed.');
    }

    // ─── 4. Seed Sample Student (for immediate dev testing) ───────────────────
    const samplePhone = '9111111111';
    const existingStudent = await User.findOne({ phone: samplePhone });
    if (!existingStudent) {
      const pinHash = await bcrypt.hash('123456', 12);
      await User.create({
        name: 'Demo Student',
        phone: samplePhone,
        pinHash,
        role: 'student',
        status: 'approved',
        monthlyFee: 1000,
      });
      console.log(`[Seed] Demo student created for phone ending ${samplePhone.slice(-4)}.`);
    }

    console.log('[Seed] Done!');
    await mongoose.connection.close();
    process.exit(0);
  } catch (err) {
    console.error('[Seed] Error:', err);
    await mongoose.connection.close();
    process.exit(1);
  }
}

seed();
