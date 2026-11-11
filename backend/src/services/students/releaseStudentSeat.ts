import mongoose, { ClientSession, Types } from 'mongoose';
import { createError } from '../../middleware/errorHandler';
import { Session } from '../../models/Session';
import { User, UserStatus } from '../../models/User';
import { performForceCheckout } from '../forceCheckout';

type StudentStateUpdate = {
  status?: UserStatus;
  isDeleted?: boolean;
  deletedAt?: Date | null;
  monthlyFee?: number;
};

interface ReleaseOptions {
  stateUpdate?: StudentStateUpdate;
  expectedStatus?: UserStatus;
}

interface AssignmentSnapshot {
  seatNumber?: number;
  shiftHours?: number;
}

function isUnsupportedTransactionError(error: unknown): boolean {
  const err = error as { code?: number; codeName?: string; message?: string };
  return (
    err?.code === 20 ||
    err?.code === 303 ||
    err?.codeName === 'IllegalOperation' ||
    /transactions are not supported|transaction numbers are only allowed|does not support transactions/i.test(
      err?.message ?? ''
    )
  );
}

function assignmentFilter(assignment: AssignmentSnapshot): Record<string, unknown> {
  return {
    ...(assignment.seatNumber === undefined
      ? { seatNumber: { $exists: false } }
      : { seatNumber: assignment.seatNumber }),
    ...(assignment.shiftHours === undefined
      ? { shiftHours: { $exists: false } }
      : { shiftHours: assignment.shiftHours }),
  };
}

function hasAssignment(student: AssignmentSnapshot): boolean {
  return student.seatNumber !== undefined || student.shiftHours !== undefined;
}

function stateMatches(
  student: {
    status: UserStatus;
    isDeleted: boolean;
    deletedAt: Date | null;
    monthlyFee: number;
  },
  stateUpdate: StudentStateUpdate = {}
): boolean {
  return Object.entries(stateUpdate).every(
    ([field, value]) => student[field as keyof typeof student]?.valueOf() === value?.valueOf()
  );
}

async function checkoutActiveSession(
  studentId: Types.ObjectId,
  session?: ClientSession
): Promise<Types.ObjectId | null> {
  let query = Session.findOne({ student: studentId, status: 'active' }).select('_id');
  if (session) query = query.session(session);
  const activeSession = await query;
  if (!activeSession) return null;

  const result = await performForceCheckout(activeSession._id, {
    session,
    resolveAlerts: !session,
  });
  if (result.session?.status === 'active') {
    throw createError('Could not force-checkout the student’s active session.', 409);
  }
  return activeSession._id;
}

async function releaseInTransaction(
  studentId: Types.ObjectId,
  stateUpdate: StudentStateUpdate,
  expectedStatus?: UserStatus
): Promise<Types.ObjectId | null> {
  const dbSession = await mongoose.startSession();
  let checkedOutSessionId: Types.ObjectId | null = null;
  try {
    await dbSession.withTransaction(async () => {
      const student = await User.findOne({ _id: studentId, role: 'student' }).session(dbSession);
      if (!student) throw createError('Student not found.', 404);
      if (expectedStatus && student.status !== expectedStatus) {
        throw createError('Student status changed. Reload and try again.', 409);
      }

      const assignment: AssignmentSnapshot = {
        seatNumber: student.seatNumber,
        shiftHours: student.shiftHours,
      };
      const needsRelease = hasAssignment(assignment);
      const needsStateUpdate = !stateMatches(student, stateUpdate);
      checkedOutSessionId = await checkoutActiveSession(student._id, dbSession);
      if (!needsRelease && !needsStateUpdate) return;

      const filter = {
        _id: student._id,
        role: 'student',
        status: student.status,
        isDeleted: student.isDeleted,
        ...assignmentFilter(assignment),
      };
      const update: Record<string, unknown> = {
        ...(needsStateUpdate && { $set: stateUpdate }),
        ...(needsRelease && { $unset: { seatNumber: 1, shiftHours: 1 } }),
      };
      const result = await User.updateOne(filter, update, { session: dbSession });
      if (result.matchedCount !== 1) {
        throw createError('Student assignment changed. Reload and try again.', 409);
      }
    });
  } finally {
    await dbSession.endSession();
  }
  return checkedOutSessionId;
}

async function releaseWithOrderedUpdates(
  studentId: Types.ObjectId,
  stateUpdate: StudentStateUpdate,
  expectedStatus?: UserStatus
): Promise<void> {
  const student = await User.findOne({ _id: studentId, role: 'student' });
  if (!student) throw createError('Student not found.', 404);
  if (expectedStatus && student.status !== expectedStatus) {
    throw createError('Student status changed. Reload and try again.', 409);
  }

  const assignment: AssignmentSnapshot = {
    seatNumber: student.seatNumber,
    shiftHours: student.shiftHours,
  };
  const needsRelease = hasAssignment(assignment);
  const needsStateUpdate = !stateMatches(student, stateUpdate);

  if (needsStateUpdate) {
    const stateResult = await User.updateOne(
      { _id: student._id, role: 'student', status: student.status, isDeleted: student.isDeleted },
      { $set: stateUpdate },
      { runValidators: true }
    );
    if (stateResult.matchedCount !== 1) {
      const current = await User.findOne({ _id: studentId, role: 'student' });
      if (!current || !stateMatches(current, stateUpdate)) {
        throw createError('Student status changed. Reload and try again.', 409);
      }
    }
  }

  await checkoutActiveSession(student._id);

  if (!needsRelease) return;
  const released = await User.updateOne(
    {
      _id: student._id,
      role: 'student',
      ...stateUpdate,
      ...assignmentFilter(assignment),
    },
    { $unset: { seatNumber: 1, shiftHours: 1 } }
  );
  if (released.matchedCount === 1) return;

  const current = await User.findOne({ _id: studentId, role: 'student' });
  if (current && !hasAssignment(current) && stateMatches(current, stateUpdate)) return;
  throw createError('Student assignment changed. Reload and try again.', 409);
}

export async function releaseStudentSeat(
  studentId: string | Types.ObjectId,
  options: ReleaseOptions = {}
): Promise<void> {
  if (!mongoose.isValidObjectId(studentId)) throw createError('Student not found.', 404);
  const id = new Types.ObjectId(studentId);
  const stateUpdate = options.stateUpdate ?? {};
  const expectedStatus = options.expectedStatus;

  try {
    const checkedOutSessionId = await releaseInTransaction(id, stateUpdate, expectedStatus);
    if (checkedOutSessionId) {
      const { resolveOvertimeAlerts } = await import('../notifications/overtimeActions');
      await resolveOvertimeAlerts(checkedOutSessionId);
    }
  } catch (error) {
    if (!isUnsupportedTransactionError(error)) throw error;
    await releaseWithOrderedUpdates(id, stateUpdate, expectedStatus);
  }
}
