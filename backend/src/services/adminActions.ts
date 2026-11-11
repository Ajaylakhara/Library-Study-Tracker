import mongoose from 'mongoose';
import { createError } from '../middleware/errorHandler';
import { Fee, IFee } from '../models/Fee';
import { User, IUser, UserStatus } from '../models/User';
import { NotificationService } from './notifications/NotificationService';
import { releaseStudentSeat } from './students/releaseStudentSeat';
import { assertSeatAssignable } from '../utils/seatAssignments';

export interface StudentStatusActionResult {
  student: IUser;
  alreadyHandled: boolean;
}

export async function updateStudentStatus(
  studentId: string | mongoose.Types.ObjectId,
  status: UserStatus,
  monthlyFee?: number,
  expectedStatus?: UserStatus
): Promise<StudentStatusActionResult> {
  const student = await User.findOne({
    _id: studentId,
    role: 'student',
    isDeleted: false,
  });
  if (!student) throw createError('Student not found.', 404);
  if (student.status === status) return { student, alreadyHandled: true };
  if (expectedStatus && student.status !== expectedStatus) {
    return { student, alreadyHandled: true };
  }

  if (status === 'approved') {
    if (student.seatNumber === undefined || student.shiftHours === undefined) {
      throw createError('Choose an available seat and shift before approving this student.', 409);
    }
    await assertSeatAssignable(student.seatNumber, student._id);

    const updated = await User.findOneAndUpdate(
      {
        _id: student._id,
        role: 'student',
        isDeleted: false,
        status: student.status,
        seatNumber: student.seatNumber,
        shiftHours: student.shiftHours,
      },
      { $set: { status, ...(monthlyFee !== undefined && { monthlyFee }) } },
      { new: true, runValidators: true }
    );
    if (!updated) {
      const current = await User.findOne({ _id: student._id, role: 'student', isDeleted: false });
      if (!current) throw createError('Student not found.', 404);
      if (current.status === status) return { student: current, alreadyHandled: true };
      if (expectedStatus && current.status !== expectedStatus) {
        return { student: current, alreadyHandled: true };
      }
      throw createError('Student status changed. Reload and try again.', 409);
    }

    await enqueueStatusNotification(updated, status);
    return { student: updated, alreadyHandled: false };
  }

  const releaseSeat =
    status === 'blocked' ||
    status === 'rejected' ||
    (status === 'pending' && student.status === 'approved');

  if (releaseSeat) {
    try {
      await releaseStudentSeat(student._id, {
        stateUpdate: {
          status,
          ...(monthlyFee !== undefined && { monthlyFee }),
        },
        expectedStatus: student.status,
      });
    } catch (error) {
      const current = await User.findOne({ _id: student._id, role: 'student', isDeleted: false });
      if (current?.status === status) return { student: current, alreadyHandled: true };
      if (current && expectedStatus && current.status !== expectedStatus) {
        return { student: current, alreadyHandled: true };
      }
      throw error;
    }
    const updated = await User.findById(student._id);
    if (!updated) throw createError('Student not found.', 404);
    await enqueueStatusNotification(updated, status);
    return { student: updated, alreadyHandled: false };
  }

  const updated = await User.findOneAndUpdate(
    { _id: student._id, role: 'student', isDeleted: false, status: student.status },
    { $set: { status, ...(monthlyFee !== undefined && { monthlyFee }) } },
    { new: true, runValidators: true }
  );
  if (!updated) {
    const current = await User.findOne({ _id: student._id, role: 'student', isDeleted: false });
    if (!current) throw createError('Student not found.', 404);
    if (current.status === status) return { student: current, alreadyHandled: true };
    if (expectedStatus && current.status !== expectedStatus) {
      return { student: current, alreadyHandled: true };
    }
    throw createError('Student status changed. Reload and try again.', 409);
  }
  await enqueueStatusNotification(updated, status);
  return { student: updated, alreadyHandled: false };
}

async function enqueueStatusNotification(student: IUser, status: UserStatus): Promise<void> {
  if (status !== 'approved' && status !== 'rejected') return;
  await NotificationService.enqueue({
    userId: student._id,
    type: status,
    vars: { name: student.name },
  });
}

export interface MarkFeePaidResult {
  fee: IFee | null;
  alreadyHandled: boolean;
}

export async function markFeePaid(
  feeId: string | mongoose.Types.ObjectId,
  adminId: mongoose.Types.ObjectId,
  note?: string
): Promise<MarkFeePaidResult> {
  const fee = await Fee.findOneAndUpdate(
    { _id: feeId, status: 'unpaid' },
    {
      $set: {
        status: 'paid',
        paidAt: new Date(),
        markedBy: adminId,
        ...(note !== undefined && { note }),
      },
    },
    { new: true, runValidators: true }
  );
  if (fee) return { fee, alreadyHandled: false };

  const existing = await Fee.findById(feeId);
  if (!existing) throw createError('Fee record not found.', 404);
  return { fee: existing, alreadyHandled: true };
}

export async function enqueueFeeReminder(feeId: string | mongoose.Types.ObjectId): Promise<void> {
  const fee = await Fee.findOne({ _id: feeId, status: 'unpaid' }).populate<{
    student: Pick<IUser, '_id' | 'name' | 'isDeleted'>;
  }>('student', '_id name isDeleted');
  if (!fee) throw createError('Unpaid fee record not found.', 404);
  if (!fee.student || fee.student.isDeleted) throw createError('Student not found.', 404);

  await NotificationService.enqueue({
    userId: fee.student._id,
    type: 'fee_unpaid',
    feeId: fee._id,
    vars: { name: fee.student.name, amount: fee.amount, month: fee.month },
  });
}
