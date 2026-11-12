import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { config } from '../config';
import { User } from '../models/User';

class AdminUpdateError extends Error {}

interface AdminUpdateOptions {
  phone: string;
  pin: string;
  oldPhone?: string;
}

function parseArguments(args: string[]): AdminUpdateOptions {
  const parsed: Partial<AdminUpdateOptions> = {};
  const allowedFlags = new Set(['--phone', '--pin', '--old-phone']);

  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (!allowedFlags.has(flag)) {
      throw new AdminUpdateError(`Unknown argument: ${flag}`);
    }

    const value = args[index + 1];
    if (!value || value.startsWith('--')) {
      throw new AdminUpdateError(`Missing value for ${flag}.`);
    }
    if (flag === '--phone') {
      if (parsed.phone !== undefined) throw new AdminUpdateError('--phone may only be specified once.');
      parsed.phone = value;
    } else if (flag === '--pin') {
      if (parsed.pin !== undefined) throw new AdminUpdateError('--pin may only be specified once.');
      parsed.pin = value;
    } else {
      if (parsed.oldPhone !== undefined) throw new AdminUpdateError('--old-phone may only be specified once.');
      parsed.oldPhone = value;
    }
    index += 1;
  }

  const { phone, pin, oldPhone } = parsed;
  if (phone === undefined || pin === undefined) {
    throw new AdminUpdateError('Both --phone and --pin are required.');
  }
  if (!/^\d{10}$/.test(phone)) {
    throw new AdminUpdateError('Phone must be exactly 10 digits.');
  }
  if (!/^\d{6}$/.test(pin)) {
    throw new AdminUpdateError('PIN must be exactly 6 digits.');
  }
  if (
    pin === '123456' ||
    pin === '000000' ||
    pin === '111111' ||
    pin === '123123' ||
    pin === phone.slice(-6)
  ) {
    throw new AdminUpdateError('PIN is too easy to guess.');
  }
  if (oldPhone !== undefined && !/^\d{10}$/.test(oldPhone)) {
    throw new AdminUpdateError('--old-phone must be exactly 10 digits.');
  }

  return { phone, pin, oldPhone };
}

async function updateAdmin(options: AdminUpdateOptions): Promise<void> {
  await mongoose.connect(config.mongoUri, {
    serverSelectionTimeoutMS: 8000,
    bufferCommands: false,
  });

  try {
    const admins = await User.find({ role: 'admin', isDeleted: false }).select('name phone');
    const matches = options.oldPhone
      ? admins.filter((admin) => admin.phone === options.oldPhone)
      : admins;

    if (matches.length === 0) {
      throw new AdminUpdateError(
        options.oldPhone ? 'No active admin matches --old-phone.' : 'No active admin was found.'
      );
    }
    if (matches.length > 1) {
      const adminList = matches.map((admin) => `${admin.name} (${admin.phone ?? 'no phone'})`).join(', ');
      throw new AdminUpdateError(`Multiple admins match; specify --old-phone. Admins: ${adminList}`);
    }

    const admin = matches[0];
    const phoneInUse = await User.exists({ phone: options.phone, _id: { $ne: admin._id } });
    if (phoneInUse) {
      throw new AdminUpdateError('The new phone is already used by another user.');
    }

    const pinHash = await bcrypt.hash(options.pin, 12);
    const result = await User.updateOne(
      { _id: admin._id, role: 'admin', isDeleted: false },
      { $set: { phone: options.phone, pinHash, failedAttempts: 0, lockedUntil: null } }
    );
    if (result.matchedCount !== 1) {
      throw new AdminUpdateError('The admin record changed before it could be updated. Please retry.');
    }

  } finally {
    await mongoose.disconnect();
  }

  console.log('Admin updated');
  console.log(options.phone);
}

if (require.main === module) {
  try {
    const options = parseArguments(process.argv.slice(2));
    updateAdmin(options).catch((error: unknown) => {
      if (error instanceof AdminUpdateError) {
        console.error(error.message);
      } else {
        const err = error as { code?: number; name?: string };
        console.error(
          err.code === 11000
            ? 'The new phone is already used by another user.'
            : `Admin update failed (${err.name ?? 'Error'}).`
        );
      }
      process.exitCode = 1;
    });
  } catch (error) {
    console.error(error instanceof AdminUpdateError ? error.message : 'Admin update failed.');
    process.exitCode = 1;
  }
}
