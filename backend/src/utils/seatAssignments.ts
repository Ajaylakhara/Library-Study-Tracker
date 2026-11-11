import mongoose from 'mongoose';
import { Seat, TOTAL_SEATS } from '../models/Seat';
import { Session } from '../models/Session';
import { User } from '../models/User';
import { createError } from '../middleware/errorHandler';

export async function getAssignableSeatNumbers(exceptStudentId?: mongoose.Types.ObjectId): Promise<number[]> {
  const [seats, assignedSeatNumbers, occupiedSeatIds] = await Promise.all([
    Seat.find({ number: { $gte: 1, $lte: TOTAL_SEATS } }).select('number isActive').lean(),
    User.distinct('seatNumber', {
      role: 'student',
      isDeleted: false,
      status: { $in: ['pending', 'approved'] },
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
  const seatsByNumber = new Map(seats.map((seat) => [seat.number, seat]));
  return Array.from({ length: TOTAL_SEATS }, (_, index) => index + 1).filter((number) => {
    const seat = seatsByNumber.get(number);
    return (seat?.isActive ?? true) && !unavailable.has(number);
  });
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
