import { Response, NextFunction } from 'express';
import { z } from 'zod';
import bcrypt from 'bcryptjs';
import { AuthRequest } from '../middleware/auth';
import { Session } from '../models/Session';
import { Seat } from '../models/Seat';
import { Fee } from '../models/Fee';
import { User } from '../models/User';
import { createError } from '../middleware/errorHandler';
import { diffMinutes, formatDuration, startOfMonthIST, endOfMonthIST } from '../utils/time';
import { getAssignableSeatNumbers } from '../utils/seatAssignments';
import { resolveOvertimeAlerts } from '../services/notifications/overtimeActions';

// ─── Status ──────────────────────────────────────────────────────────────────

export const getStatus = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const student = req.user!;
    const activeSession = await Session.findOne({ student: student._id, status: 'active' })
      .populate('seat', 'number');

    res.json({
      success: true,
      data: {
        student: {
          id: student._id,
          name: student.name,
          phone: student.phone,
          email: student.email,
          seatNumber: student.seatNumber,
          shiftHours: student.shiftHours,
          status: student.status,
          monthlyFee: student.monthlyFee,
        },
        activeSession: activeSession
          ? {
              id: activeSession._id,
              seatNumber: (activeSession.seat as unknown as { number: number })?.number ?? student.seatNumber,
              shiftHours: activeSession.shiftHours,
              checkInAt: activeSession.checkInAt,
              shiftEndsAt: activeSession.shiftEndsAt,
              status: activeSession.status,
            }
          : null,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ─── Available Seats ─────────────────────────────────────────────────────────

export const getAvailableSeats = async (_req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const available = await getAssignableSeatNumbers(_req.user?._id);

    res.json({ success: true, data: available, count: available.length });
  } catch (err) {
    next(err);
  }
};

// ─── Check-in ────────────────────────────────────────────────────────────────

export const checkIn = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const student = req.user!;
    const { seat: seatNumber, shiftHours } = z.object({
      seat: z.number().int().min(1).max(70),
      shiftHours: z.union([z.literal(4), z.literal(12), z.literal(24)]),
    }).parse(req.body);

    if (student.status !== 'approved') {
      throw createError('Your account must be approved to check in.', 403);
    }

    // 1. Check if student already has an active session
    const existingStudentSession = await Session.findOne({
      student: student._id,
      status: 'active',
    });
    if (existingStudentSession) {
      throw createError('Seat is occupied or you are already checked in. Please wait or contact admin.', 409);
    }

    // 2. Create any legacy missing seat record as active; preserve existing activation state.
    const seat = await Seat.findOneAndUpdate(
      { number: seatNumber },
      { $setOnInsert: { number: seatNumber, isActive: true } },
      { new: true, upsert: true, setDefaultsOnInsert: true }
    );
    if (!seat.isActive) {
      throw createError(`Seat ${seatNumber} is inactive. Please contact an admin.`, 409);
    }

    // 3. Check if seat is currently occupied by another active session
    const existingSeatSession = await Session.findOne({
      seat: seat._id,
      status: 'active',
    });
    if (existingSeatSession) {
      throw createError('Seat is occupied or you are already checked in. Please wait or contact admin.', 409);
    }

    if (student.seatNumber !== undefined && seatNumber !== student.seatNumber) {
      throw createError(`Your assigned seat is ${student.seatNumber}.`, 400);
    }
    if (student.shiftHours !== undefined && shiftHours !== student.shiftHours) {
      throw createError(`Your assigned shift is ${student.shiftHours} hours.`, 400);
    }

    const now = new Date();
    const shiftEndsAt = new Date(now.getTime() + shiftHours * 60 * 60 * 1000);

    const session = await Session.create({
      student: student._id,
      seat: seat._id,
      shiftHours,
      checkInAt: now,
      shiftEndsAt,
      status: 'active',
    });

    res.status(201).json({
      success: true,
      message: `Checked in to Seat ${seatNumber} for ${shiftHours}h shift.`,
      data: {
        sessionId: session._id,
        seatNumber,
        shiftHours,
        checkInAt: session.checkInAt,
        shiftEndsAt: session.shiftEndsAt,
      },
    });
  } catch (err: unknown) {
    // If Mongo partial unique index caught a concurrent collision
    if ((err as { code?: number }).code === 11000) {
      return next(createError('Seat is occupied or you are already checked in. Please wait or contact admin.', 409));
    }
    next(err);
  }
};

// ─── Check-out ───────────────────────────────────────────────────────────────

export const checkOut = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const student = req.user!;
    const now = new Date();

    const session = await Session.findOneAndUpdate(
      { student: student._id, status: 'active' },
      [
        {
          $set: {
          status: 'completed',
          checkoutType: 'manual',
          checkOutAt: now,
            durationMinutes: {
              $max: [
                0,
                {
                  $floor: {
                    $divide: [
                      { $subtract: [{ $min: [now, '$shiftEndsAt'] }, '$checkInAt'] },
                      60000,
                    ],
                  },
                },
              ],
            },
          },
        },
      ],
      { new: true }
    );

    if (!session) throw createError('No active session found.', 404);
    await resolveOvertimeAlerts(session._id);

    const durationMinutes = session.durationMinutes ?? 0;
    const studyTime = formatDuration(durationMinutes);

    res.json({
      success: true,
      message: 'Checked out successfully.',
      data: {
        sessionId: session._id,
        durationMinutes,
        studyTime,
        durationFormatted: studyTime,
        checkOutAt: now,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ─── Attendance ──────────────────────────────────────────────────────────────

export const getAttendance = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const student = req.user!;
    const month = (req.query.month as string) ?? '';

    if (month && !/^\d{4}-\d{2}$/.test(month)) {
      throw createError('month must be in YYYY-MM format.', 400);
    }

    const filter: Record<string, unknown> = { student: student._id };
    if (month) {
      filter.checkInAt = {
        $gte: startOfMonthIST(month),
        $lte: endOfMonthIST(month),
      };
    }

    const sessions = await Session.find(filter).sort({ checkInAt: -1 }).populate('seat', 'number');

    const data = sessions.map((s) => ({
      id: s._id,
      seatNumber: (s.seat as unknown as { number: number })?.number,
      shiftHours: s.shiftHours,
      checkInAt: s.checkInAt,
      shiftEndsAt: s.shiftEndsAt,
      checkOutAt: s.checkOutAt,
      durationMinutes: s.durationMinutes,
      durationFormatted: s.durationMinutes !== null ? formatDuration(s.durationMinutes) : null,
      status: s.status,
      checkoutType: s.checkoutType,
    }));

    res.json({ success: true, data, count: data.length });
  } catch (err) {
    next(err);
  }
};

// ─── Summary ─────────────────────────────────────────────────────────────────

export const getSummary = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const student = req.user!;
    const month = (req.query.month as string) ?? '';

    if (!month || !/^\d{4}-\d{2}$/.test(month)) {
      throw createError('month (YYYY-MM) is required.', 400);
    }

    const sessions = await Session.find({
      student: student._id,
      status: 'completed',
      checkInAt: { $gte: startOfMonthIST(month), $lte: endOfMonthIST(month) },
    });

    const totalMinutes = sessions.reduce((sum, s) => sum + (s.durationMinutes ?? 0), 0);
    const totalSessions = sessions.length;

    res.json({
      success: true,
      data: {
        month,
        totalSessions,
        totalMinutes,
        totalFormatted: formatDuration(totalMinutes),
      },
    });
  } catch (err) {
    next(err);
  }
};

// ─── Fees ────────────────────────────────────────────────────────────────────

export const getMyFees = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const student = req.user!;
    const fees = await Fee.find({ student: student._id }).sort({ month: -1 });
    res.json({ success: true, data: fees, count: fees.length });
  } catch (err) {
    next(err);
  }
};

// ─── Profile ─────────────────────────────────────────────────────────────────

export const getProfile = (req: AuthRequest, res: Response): void => {
  const u = req.user!;
  res.json({
    success: true,
    data: {
      id: u._id,
      name: u.name,
      phone: u.phone,
      email: u.email,
      seatNumber: u.seatNumber,
      shiftHours: u.shiftHours,
      whatsappOptIn: u.whatsappOptIn,
      smsOptIn: u.smsOptIn,
      preferredChannel: u.preferredChannel,
      monthlyFee: u.monthlyFee,
      status: u.status,
    },
  });
};

const updateProfileSchema = z.object({
  name: z.string().min(2).max(100).trim().optional(),
  phone: z.string().regex(/^\d{10}$/).optional(),
  whatsappOptIn: z.boolean().optional(),
  smsOptIn: z.boolean().optional(),
  preferredChannel: z.enum(['whatsapp', 'sms']).optional(),
});

export const updateProfile = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const updates = updateProfileSchema.parse(req.body);
    const updated = await User.findByIdAndUpdate(req.user!._id, updates, { new: true });
    res.json({ success: true, message: 'Profile updated.', data: updated });
  } catch (err) {
    next(err);
  }
};

// ─── Change PIN ───────────────────────────────────────────────────────────────

const changePinSchema = z.object({
  oldPin: z.string().regex(/^\d{6}$/, 'Current PIN must be 6 digits'),
  newPin: z.string().regex(/^\d{6}$/, 'New PIN must be 6 digits'),
});

export const changePin = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { oldPin, newPin } = changePinSchema.parse(req.body);

    const user = await User.findById(req.user!._id).select('+pinHash');
    if (!user) throw createError('User not found.', 404);

    const isMatch = await user.comparePin(oldPin);
    if (!isMatch) throw createError('Current PIN is incorrect.', 401);

    const pinHash = await bcrypt.hash(newPin, 12);
    await User.findByIdAndUpdate(user._id, { pinHash });

    res.json({ success: true, message: 'PIN changed successfully.' });
  } catch (err) {
    next(err);
  }
};
