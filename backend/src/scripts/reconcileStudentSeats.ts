import path from 'path';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { User } from '../models/User';
import { Session } from '../models/Session';

dotenv.config();
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

class SafeReconciliationError extends Error {}

async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'test') {
    throw new SafeReconciliationError('Seat reconciliation cannot run when NODE_ENV=test.');
  }

  const apply = process.argv.includes('--apply');
  const dryRun = process.argv.includes('--dry-run') || !apply;
  if (apply && process.argv.includes('--dry-run')) {
    throw new SafeReconciliationError('Choose either --dry-run or --apply, not both.');
  }

  const unknownArguments = process.argv.slice(2).filter((argument) => argument !== '--apply' && argument !== '--dry-run');
  if (unknownArguments.length > 0) {
    throw new SafeReconciliationError(`Unknown argument: ${unknownArguments[0]}`);
  }

  const uri = (process.env.MONGODB_URI || process.env.MONGO_URI || '').trim();
  if (!uri) throw new SafeReconciliationError('MONGODB_URI is required to reconcile student seats.');

  let databaseName: string;
  try {
    const parsedUri = new URL(uri);
    if (!['mongodb:', 'mongodb+srv:'].includes(parsedUri.protocol)) throw new Error();
    databaseName = decodeURIComponent(parsedUri.pathname.replace(/^\/+/, ''));
    if (!databaseName) throw new Error();
  } catch {
    throw new SafeReconciliationError('MONGODB_URI must be a valid MongoDB URI with a database name.');
  }

  console.log(`MongoDB database: ${databaseName}`);
  console.log(dryRun ? 'Mode: dry run (read-only).' : 'Mode: apply.');

  await mongoose.connect(uri, {
    serverSelectionTimeoutMS: 8000,
    bufferCommands: false,
  });
  try {
    const students = await User.find({
      role: 'student',
      $and: [
        { $or: [{ isDeleted: true }, { status: { $in: ['blocked', 'rejected'] } }] },
        { $or: [{ seatNumber: { $exists: true } }, { shiftHours: { $exists: true } }] },
      ],
    }).select('_id status isDeleted seatNumber shiftHours');

    if (students.length === 0) {
      console.log('No deleted, blocked, or rejected students have a seat/shift assignment.');
      return;
    }

    for (const student of students) {
      const activeSession = await Session.exists({ student: student._id, status: 'active' });
      const assignment = [
        student.seatNumber === undefined ? null : `seat ${student.seatNumber}`,
        student.shiftHours === undefined ? null : `${student.shiftHours}h shift`,
      ].filter(Boolean).join(', ');
      console.log(
        `${student._id} | ${student.isDeleted ? 'deleted' : student.status} | ${assignment}` +
        `${activeSession ? ' | active session will be force-checked out' : ''} | would clear assignment`
      );

      if (apply) {
        const { releaseStudentSeat } = await import('../services/students/releaseStudentSeat');
        await releaseStudentSeat(student._id);
      }
    }

    if (dryRun) console.log('No records were changed. Re-run with --apply to apply these changes.');
  } finally {
    await mongoose.disconnect();
  }
}

main().catch((error: unknown) => {
  const err = error as { name?: string };
  if (error instanceof SafeReconciliationError) {
    console.error(error.message);
  } else {
    console.error(`Seat reconciliation failed (${err.name ?? 'Error'}). No URI details were logged.`);
  }
  process.exitCode = 1;
});
