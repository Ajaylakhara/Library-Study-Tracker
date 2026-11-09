import mongoose from 'mongoose';
import { Seat } from '../models/Seat';
import { Session } from '../models/Session';
import { User } from '../models/User';
import { createError } from '../middleware/errorHandler';

export async function getAssignableSeatNumbers(exceptStudentId?: mongoose.Types.ObjectId): Promise<number[]> {
  const [seats, assignedSeatNumbers, occupiedSeatIds] = await Promise.all([
    Seat.find({ isActive: true }).sort({ number: 1 }).select('number').lean(),
    User.distinct('seatNumber', {
      role: 'student',
      isDeleted: false,
      seatNumber: { $exists: true },
      ...(exceptStudentId && { _id: { $ne: exceptStudentId } }),
    }),
    Session.distinct('seat', {
      status: 'active',
      ...(exceptStudentId && { student: { $ne: exceptStudentId } }),
    }),
  ]);

  const occupiedSeatNumbers = await Seat.distinct('number', { _id: { $in: occupiedSeatIds } });
  const unavailable = new Set([...assignedSeatNumbers, ...occupiedSeatNumbers]);
  return seats.map((seat) => seat.number).filter((number) => !unavailable.has(number));
}

export async function assertSeatAssignable(seatNumber: number, exceptStudentId?: mongoose.Types.ObjectId): Promise<void> {
  const availableSeats = await getAssignableSeatNumbers(exceptStudentId);
  if (!availableSeats.includes(seatNumber)) {
    throw createError(
      `Seat ${seatNumber} is unavailable. Please choose another seat.`,
      409
    );
  }
}
