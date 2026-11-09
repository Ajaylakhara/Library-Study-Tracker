import { Response, NextFunction } from 'express';
import { z } from 'zod';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import { randomInt } from 'crypto';
import { format, fromZonedTime, toZonedTime } from 'date-fns-tz';
import { AuthRequest } from '../middleware/auth';
import { User } from '../models/User';
import { Seat } from '../models/Seat';
import { Session } from '../models/Session';
import { Fee } from '../models/Fee';
import { Notification } from '../models/Notification';
import { createError } from '../middleware/errorHandler';
import { NotificationService } from '../services/notifications/NotificationService';
import { assertSeatAssignable, getAssignableSeatNumbers } from '../utils/seatAssignments';
import { generateMonthlyFees } from '../jobs/monthlyFees';
import { buildCsv } from '../utils/csv';
import { resolveOvertimeAlerts } from '../services/notifications/overtimeActions';
import { performForceCheckout } from '../services/notifications/adminBotHandlers';
import { releaseStudentSeat } from '../services/students/releaseStudentSeat';
import {
  diffMinutes,
  formatDuration,
  startOfMonthIST,
  endOfMonthIST,
  toMonthString,
  nowIST,
  TZ,
} from '../utils/time';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function parsePagination(query: Record<string, unknown>) {
  const page = Math.max(1, parseInt(String(query.page ?? '1'), 10));
  const limit = Math.min(100, Math.max(1, parseInt(String(query.limit ?? '20'), 10)));
  return { page, limit, skip: (page - 1) * limit };
}

// ─── Live Seats ──────────────────────────────────────────────────────────────

export const getLiveSeats = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const activeSessions = await Session.find({ status: 'active' })
      .populate('student', 'name phone')
      .populate('seat', 'number');

    const activeMap = new Map<string, (typeof activeSessions)[number]>();
    for (const session of activeSessions) {
      const seat = session.seat as unknown as { _id: mongoose.Types.ObjectId } | null;
      if (seat?._id) activeMap.set(seat._id.toString(), session);
    }

    const allSeats = await Seat.find().sort({ number: 1 });

    const data = allSeats.map((seat) => {
      const session = activeMap.get(seat._id.toString());
      const student = session?.student as unknown as {
        _id?: mongoose.Types.ObjectId;
        name?: string;
        phone?: string;
      } | null;
      return {
        seatId: seat._id,
        seatNumber: seat.number,
        isActive: seat.isActive,
        isOccupied: !!session,
        session: session
          ? {
              sessionId: session._id,
              student: {
                _id: student?._id?.toString() ?? '',
                name: student?.name ?? 'Former student',
                phone: student?.phone ?? '',
              },
              shiftHours: session.shiftHours,
              checkInAt: session.checkInAt,
              shiftEndsAt: session.shiftEndsAt,
            }
          : null,
      };
    });

    res.json({ success: true, data });
  } catch (err) {
    next(err);
  }
};

// ─── Students ────────────────────────────────────────────────────────────────

const createStudentSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(100).trim(),
  phone: z.string().regex(/^\d{10}$/, 'Phone must be a 10-digit Indian mobile number'),
  pin: z.string().regex(/^\d{6}$/, 'PIN must be exactly 6 digits').optional(),
  seatNumber: z.number().int().min(1).max(70),
  shiftHours: z.union([z.literal(4), z.literal(12), z.literal(24)]),
  monthlyFee: z.number().min(0),
  whatsappOptIn: z.boolean(),
  smsOptIn: z.boolean(),
});

function generateStudentPin(): string {
  return randomInt(0, 1_000_000).toString().padStart(6, '0');
}

export const createStudent = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const input = createStudentSchema.parse(req.body);
    const existingUser = await User.findOne({ phone: input.phone, isDeleted: false }).select('_id');
    if (existingUser) throw createError('This phone number is already registered.', 409);
    await assertSeatAssignable(input.seatNumber);

    const pin = input.pin ?? generateStudentPin();
    const pinHash = await bcrypt.hash(pin, 12);

    let student;
    try {
      student = await User.create({
        name: input.name,
        phone: input.phone,
        pinHash,
        seatNumber: input.seatNumber,
        shiftHours: input.shiftHours,
        role: 'student',
        status: 'approved',
        monthlyFee: input.monthlyFee,
        whatsappOptIn: input.whatsappOptIn,
        smsOptIn: input.smsOptIn,
      });
    } catch (err) {
      if (err && typeof err === 'object' && 'code' in err && err.code === 11000) {
        throw createError('This phone number is already registered.', 409);
      }
      throw err;
    }

    res.status(201).json({
      success: true,
      message: 'Student added successfully.',
      data: { student, pin },
    });
  } catch (err) {
    next(err);
  }
};

export const getStudents = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { page, limit, skip } = parsePagination(req.query as Record<string, unknown>);
    const { status, search, includeDeleted } = req.query as Record<string, string>;

    const filter: Record<string, unknown> = {
      role: 'student',
      isDeleted: includeDeleted === 'true',
    };
    if (status && includeDeleted !== 'true') filter.status = status;
    if (search) {
      filter.$or = [
        { name: { $regex: search, $options: 'i' } },
        { phone: { $regex: search, $options: 'i' } },
      ];
    }

    const [students, total] = await Promise.all([
      User.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
      User.countDocuments(filter),
    ]);

    res.json({ success: true, data: students, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (err) {
    next(err);
  }
};

export const getStudentById = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const student = await User.findOne({ _id: req.params.id, role: 'student', isDeleted: false });
    if (!student) throw createError('Student not found.', 404);
    res.json({ success: true, data: student });
  } catch (err) {
    next(err);
  }
};

export const getAssignableStudentSeats = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) throw createError('Student not found.', 404);
    const student = await User.findOne({ _id: req.params.id, role: 'student' }).select('_id');
    if (!student) throw createError('Student not found.', 404);

    const seats = await getAssignableSeatNumbers(student._id);
    res.json({ success: true, data: seats, count: seats.length });
  } catch (err) {
    next(err);
  }
};

const editStudentSchema = z.object({
  name: z.string().min(2).max(100).trim().optional(),
  phone: z.string().regex(/^\d{10}$/).optional(),
  email: z.union([
    z.string().email('Please enter a valid email address').trim().toLowerCase(),
    z.literal(''),
  ]).optional(),
  seatNumber: z.number().int().min(1).max(70).optional(),
  shiftHours: z.union([z.literal(4), z.literal(12), z.literal(24)]).optional(),
  monthlyFee: z.number().min(0).optional(),
  whatsappOptIn: z.boolean().optional(),
  smsOptIn: z.boolean().optional(),
  preferredChannel: z.enum(['whatsapp', 'sms']).optional(),
});

export const editStudent = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const updates = editStudentSchema.parse(req.body);
    if (!mongoose.isValidObjectId(req.params.id)) throw createError('Student not found.', 404);
    const existingStudent = await User.findOne({ _id: req.params.id, role: 'student', isDeleted: false });
    if (!existingStudent) throw createError('Student not found.', 404);

    if (updates.seatNumber !== undefined) {
      await assertSeatAssignable(updates.seatNumber, existingStudent._id);
    }

    const update: Record<string, unknown> = { ...updates };
    if (updates.email === '') {
      delete update.email;
      update.$unset = { email: 1 };
    }
    const student = await User.findOneAndUpdate(
      { _id: req.params.id, role: 'student', isDeleted: false },
      update,
      { new: true, runValidators: true }
    );
    if (!student) throw createError('Student not found.', 404);
    res.json({ success: true, message: 'Student updated.', data: student });
  } catch (err) {
    next(err);
  }
};

const updateStatusSchema = z.object({
  status: z.enum(['pending', 'approved', 'rejected', 'blocked']),
  monthlyFee: z.number().min(0).optional(),
});

export const updateStudentStatus = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { status, monthlyFee } = updateStatusSchema.parse(req.body);
    const existing = await User.findOne({
      _id: req.params.id,
      role: 'student',
      isDeleted: false,
    });
    if (!existing) throw createError('Student not found.', 404);

    if (status === 'approved') {
      if (existing.seatNumber === undefined || existing.shiftHours === undefined) {
        throw createError('Choose an available seat and shift before approving this student.', 409);
      }
      await assertSeatAssignable(existing.seatNumber, existing._id);
    }

    const releaseSeat =
      status === 'blocked' ||
      status === 'rejected' ||
      (status === 'pending' && existing.status === 'approved');
    let student;
    if (releaseSeat) {
      await releaseStudentSeat(existing._id, {
        stateUpdate: {
          status,
          ...(monthlyFee !== undefined && { monthlyFee }),
        },
      });
      student = await User.findById(existing._id);
    } else {
      student = await User.findOneAndUpdate(
          { _id: req.params.id, role: 'student', isDeleted: false },
          { status, ...(monthlyFee !== undefined && { monthlyFee }) },
          { new: true }
        );
    }
    if (!student) throw createError('Student not found.', 404);

    // Notify student on approval/rejection
    if (status === 'approved' || status === 'rejected') {
      await NotificationService.enqueue({
        userId: student._id,
        type: status,
        vars: { name: student.name },
      });
    }

    res.json({ success: true, message: `Student status updated to ${status}.`, data: student });
  } catch (err) {
    next(err);
  }
};

export const resetStudentPin = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const pin = generateStudentPin();
    const pinHash = await bcrypt.hash(pin, 12);
    const student = await User.findOneAndUpdate(
      { _id: req.params.id, role: 'student', isDeleted: false },
      { pinHash, failedAttempts: 0, lockedUntil: null },
      { new: true }
    );
    if (!student) throw createError('Student not found.', 404);

    res.json({
      success: true,
      message: 'Student PIN reset successfully.',
      data: { message: 'Student PIN reset successfully.', pin },
    });
  } catch (err) {
    next(err);
  }
};

export const deleteStudent = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;

    const targetUser = await User.findById(id);
    if (!targetUser) {
      throw createError('Student not found.', 404);
    }

    if (targetUser.role === 'admin') {
      throw createError('Admin users cannot be deleted.', 403);
    }

    if (targetUser.isDeleted) {
      throw createError('Student is already deleted.', 400);
    }

    await releaseStudentSeat(targetUser._id, {
      stateUpdate: {
        isDeleted: true,
        deletedAt: new Date(),
        status: 'rejected',
      },
    });

    res.json({
      success: true,
      message: 'Student deleted successfully.',
    });
  } catch (err) {
    next(err);
  }
};

const restoreStudentSchema = z.object({
  seatNumber: z.number().int().min(1).max(70),
  shiftHours: z.union([z.literal(4), z.literal(12), z.literal(24)]),
});

export const restoreStudent = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    if (!mongoose.isValidObjectId(req.params.id)) throw createError('Student not found.', 404);
    const { seatNumber, shiftHours } = restoreStudentSchema.parse(req.body);
    const deletedStudent = await User.findOne({
      _id: req.params.id,
      role: 'student',
      isDeleted: true,
    });
    if (!deletedStudent) throw createError('Deleted student not found.', 404);

    await assertSeatAssignable(seatNumber, deletedStudent._id);
    const student = await User.findOneAndUpdate(
      { _id: deletedStudent._id, role: 'student', isDeleted: true },
      {
        $set: {
          isDeleted: false,
          deletedAt: null,
          status: 'pending',
          seatNumber,
          shiftHours,
        },
      },
      { new: true, runValidators: true }
    );
    if (!student) throw createError('Student could not be restored. Reload and try again.', 409);

    res.json({
      success: true,
      message: 'Student restored as pending. Review and approve the student to reactivate access.',
      data: student,
    });
  } catch (err) {
    next(err);
  }
};

export const getStudentAttendance = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const { month } = req.query as Record<string, string>;

    const filter: Record<string, unknown> = { student: id };
    if (month) {
      if (!/^\d{4}-\d{2}$/.test(month)) throw createError('month must be YYYY-MM.', 400);
      filter.checkInAt = { $gte: startOfMonthIST(month), $lte: endOfMonthIST(month) };
    }

    const sessions = await Session.find(filter)
      .sort({ checkInAt: -1 })
      .populate('seat', 'number');

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

// ─── Sessions ────────────────────────────────────────────────────────────────

export const getSessions = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { page, limit, skip } = parsePagination(req.query as Record<string, unknown>);
    const { status, studentId, seatId, from, to } = req.query as Record<string, string>;

    const filter: Record<string, unknown> = {};
    if (status) filter.status = status;
    if (studentId) filter.student = studentId;
    if (seatId) filter.seat = seatId;
    if (from || to) {
      filter.checkInAt = {};
      if (from) (filter.checkInAt as Record<string, unknown>).$gte = new Date(from);
      if (to) (filter.checkInAt as Record<string, unknown>).$lte = new Date(to);
    }

    const [sessions, total] = await Promise.all([
      Session.find(filter)
        .sort({ checkInAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('student', 'name phone')
        .populate('seat', 'number'),
      Session.countDocuments(filter),
    ]);

    const data = sessions.map((s) => ({
      ...s.toObject(),
      durationFormatted: s.durationMinutes !== null ? formatDuration(s.durationMinutes!) : null,
    }));

    res.json({ success: true, data, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (err) {
    next(err);
  }
};

export const forceCheckout = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { id } = req.params;
    const result = await performForceCheckout(String(id));
    if (!result.session || result.alreadyCheckedOut) {
      throw createError('Active session not found.', 404);
    }

    res.json({
      success: true,
      message: 'Student force-checked out.',
      data: {
        sessionId: result.session._id,
        durationMinutes: result.durationMinutes,
        durationFormatted: result.durationFormatted,
      },
    });
  } catch (err) {
    next(err);
  }
};

// ─── Fees ────────────────────────────────────────────────────────────────────

export const getFees = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { page, limit, skip } = parsePagination(req.query as Record<string, unknown>);
    const { status, month, studentId } = req.query as Record<string, string>;

    const filter: Record<string, unknown> = {};
    if (status) filter.status = status;
    if (month) filter.month = month;
    if (studentId) filter.student = studentId;

    const [fees, total] = await Promise.all([
      Fee.find(filter)
        .sort({ month: -1, createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('student', 'name phone'),
      Fee.countDocuments(filter),
    ]);

    res.json({ success: true, data: fees, pagination: { page, limit, total, pages: Math.ceil(total / limit) } });
  } catch (err) {
    next(err);
  }
};

const markFeePaidSchema = z.object({
  note: z.string().max(500).trim().optional(),
});

export const markFeePaid = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { note } = markFeePaidSchema.parse(req.body ?? {});
    const fee = await Fee.findByIdAndUpdate(
      req.params.id,
      {
        status: 'paid',
        paidAt: new Date(),
        markedBy: req.user!._id,
        ...(note !== undefined && { note }),
      },
      { new: true }
    );
    if (!fee) throw createError('Fee record not found.', 404);
    res.json({ success: true, message: 'Fee marked as paid.', data: fee });
  } catch (err) {
    next(err);
  }
};

export const generateFeesManual = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const schema = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/) });
    const { month } = schema.parse(req.body);
    const result = await generateMonthlyFees(month);
    res.json({ success: true, message: `Fees generated for ${month}.`, data: result });
  } catch (err) {
    next(err);
  }
};

// ─── Reports ─────────────────────────────────────────────────────────────────

export const getReportSummary = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { from, to } = req.query as Record<string, string>;
    if (!from || !to) throw createError('from and to query params are required.', 400);

    const rangeStart = new Date(from);
    const rangeEnd = new Date(to);
    if (Number.isNaN(rangeStart.getTime()) || Number.isNaN(rangeEnd.getTime()) || rangeStart > rangeEnd) {
      throw createError('from and to must be valid dates, with from before to.', 400);
    }

    const dailyEnd = new Date(Math.min(rangeEnd.getTime(), Date.now()));
    const endDateKey = format(toZonedTime(dailyEnd, TZ), 'yyyy-MM-dd', { timeZone: TZ });
    const [year, month, day] = endDateKey.split('-').map(Number);
    const dayKeys = Array.from({ length: 30 }, (_, index) => {
      const date = new Date(Date.UTC(year, month - 1, day - 29 + index));
      return date.toISOString().slice(0, 10);
    });
    const dailyStart = fromZonedTime(`${dayKeys[0]}T00:00:00`, TZ);

    const [sessions, fees, daySessions, activeSeatCount] = await Promise.all([
      Session.find({
        status: 'completed',
        checkInAt: { $gte: rangeStart, $lte: rangeEnd },
      }).select('durationMinutes'),
      Fee.aggregate([
        { $match: { month: { $gte: from.slice(0, 7), $lte: to.slice(0, 7) } } },
        {
          $group: {
            _id: null,
            unpaidCount: { $sum: { $cond: [{ $eq: ['$status', 'unpaid'] }, 1, 0] } },
            unpaidAmount: { $sum: { $cond: [{ $eq: ['$status', 'unpaid'] }, '$amount', 0] } },
            collectedRevenue: { $sum: { $cond: [{ $eq: ['$status', 'paid'] }, '$amount', 0] } },
          },
        },
      ]),
      Session.find({
        checkInAt: { $lt: dailyEnd },
        $or: [{ checkOutAt: null }, { checkOutAt: { $gt: dailyStart } }],
      }).select('checkInAt shiftEndsAt checkOutAt'),
      Seat.countDocuments({ isActive: true }),
    ]);

    const totalMinutes = sessions.reduce((sum, session) => sum + (session.durationMinutes ?? 0), 0);
    const dailyByDate = new Map(dayKeys.map((date) => [date, { date, checkIns: 0, checkOuts: 0 }]));
    const hourTotals = new Map(
      Array.from({ length: 18 }, (_, index) => [index + 6, { occupiedSeatMinutes: 0, availableSeatMinutes: 0 }])
    );
    const hourBuckets: { hour: number; start: number; end: number }[] = [];

    for (const date of dayKeys) {
      for (let hour = 6; hour <= 23; hour += 1) {
        const bucketStart = fromZonedTime(`${date}T${String(hour).padStart(2, '0')}:00:00`, TZ).getTime();
        const bucketEnd = Math.min(bucketStart + 60 * 60 * 1000, dailyEnd.getTime());
        if (bucketStart >= dailyEnd.getTime() || bucketEnd <= bucketStart) continue;
        hourBuckets.push({ hour, start: bucketStart, end: bucketEnd });
        hourTotals.get(hour)!.availableSeatMinutes += ((bucketEnd - bucketStart) / 60000) * activeSeatCount;
      }
    }

    for (const session of daySessions) {
      const checkInAt = session.checkInAt.getTime();
      const checkOutAt = session.checkOutAt?.getTime();
      if (checkInAt >= dailyStart.getTime() && checkInAt < dailyEnd.getTime()) {
        const key = format(toZonedTime(session.checkInAt, TZ), 'yyyy-MM-dd', { timeZone: TZ });
        const entry = dailyByDate.get(key);
        if (entry) entry.checkIns += 1;
      }
      if (checkOutAt !== undefined && checkOutAt >= dailyStart.getTime() && checkOutAt <= dailyEnd.getTime()) {
        const key = format(toZonedTime(session.checkOutAt!, TZ), 'yyyy-MM-dd', { timeZone: TZ });
        const entry = dailyByDate.get(key);
        if (entry) entry.checkOuts += 1;
      }

      const sessionStart = Math.max(checkInAt, dailyStart.getTime());
      const sessionEnd = Math.min(checkOutAt ?? dailyEnd.getTime(), dailyEnd.getTime());
      if (sessionEnd <= sessionStart) continue;

      for (const bucket of hourBuckets) {
        const overlap = Math.max(0, Math.min(sessionEnd, bucket.end) - Math.max(sessionStart, bucket.start));
        hourTotals.get(bucket.hour)!.occupiedSeatMinutes += overlap / 60000;
      }
    }

    const daily = dayKeys.map((date) => dailyByDate.get(date)!);
    const hourly = Array.from(hourTotals, ([hour, totals]) => ({
      hour,
      averageOccupancy: totals.availableSeatMinutes
        ? Math.round((totals.occupiedSeatMinutes / totals.availableSeatMinutes) * 100)
        : 0,
    }));

    res.json({
      success: true,
      data: {
        period: { from, to },
        totalSessions: sessions.length,
        totalMinutes,
        totalFormatted: formatDuration(totalMinutes),
        unpaidFees: fees[0]?.unpaidCount ?? 0,
        unpaidFeeAmount: fees[0]?.unpaidAmount ?? 0,
        collectedRevenue: fees[0]?.collectedRevenue ?? 0,
        daily,
        hourly,
      },
    });
  } catch (err) {
    next(err);
  }
};

export const getStudentsReport = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { month } = req.query as Record<string, string>;
    if (!month || !/^\d{4}-\d{2}$/.test(month)) throw createError('month (YYYY-MM) is required.', 400);

    const sessions = await Session.aggregate([
      {
        $match: {
          status: 'completed',
          checkInAt: { $gte: startOfMonthIST(month), $lte: endOfMonthIST(month) },
        },
      },
      {
        $group: {
          _id: '$student',
          totalMinutes: { $sum: '$durationMinutes' },
          sessions: { $sum: 1 },
        },
      },
      { $sort: { totalMinutes: -1 } },
    ]);

    const studentIds = sessions.map((s) => s._id);
    const users = await User.find({ _id: { $in: studentIds } }).lean();
    const userMap = new Map(users.map((u) => [u._id.toString(), u]));

    const data = sessions.map((s) => ({
      student: userMap.get(s._id.toString()),
      totalMinutes: s.totalMinutes,
      totalFormatted: formatDuration(s.totalMinutes),
      totalSessions: s.sessions,
    }));

    res.json({ success: true, data, month });
  } catch (err) {
    next(err);
  }
};

export const exportAttendanceCsv = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { from, to, studentId } = req.query as Record<string, string>;

    const filter: Record<string, unknown> = { status: 'completed' };
    if (from || to) {
      filter.checkInAt = {};
      if (from) (filter.checkInAt as Record<string, unknown>).$gte = new Date(from);
      if (to) (filter.checkInAt as Record<string, unknown>).$lte = new Date(to);
    }
    if (studentId) filter.student = studentId;

    const sessions = await Session.find(filter)
      .sort({ checkInAt: -1 })
      .populate('student', 'name phone')
      .populate('seat', 'number')
      .lean();

    const rows = sessions.map((s) => {
      const student = s.student as unknown as { name: string; phone: string };
      const seat = s.seat as unknown as { number: number };
      return {
        sessionId: s._id.toString(),
        studentName: student?.name ?? '',
        studentPhone: student?.phone ?? '',
        seatNumber: seat?.number ?? '',
        shiftHours: s.shiftHours,
        checkInAt: s.checkInAt?.toISOString() ?? '',
        shiftEndsAt: s.shiftEndsAt?.toISOString() ?? '',
        checkOutAt: s.checkOutAt?.toISOString() ?? '',
        durationMinutes: s.durationMinutes ?? '',
        durationFormatted: s.durationMinutes !== null ? formatDuration(s.durationMinutes!) : '',
        checkoutType: s.checkoutType ?? '',
      };
    });

    const headers = [
      'sessionId', 'studentName', 'studentPhone', 'seatNumber', 'shiftHours',
      'checkInAt', 'shiftEndsAt', 'checkOutAt', 'durationMinutes', 'durationFormatted', 'checkoutType',
    ];

    const csv = buildCsv(headers, rows);

    res.setHeader('Content-Type', 'text/csv');
    res.setHeader('Content-Disposition', 'attachment; filename="attendance.csv"');
    res.send(csv);
  } catch (err) {
    next(err);
  }
};

// ─── Notifications ────────────────────────────────────────────────────────────

const ADMIN_ALERT_FILTER = {
  $or: [
    { status: 'failed' },
    {
      channel: 'inapp',
      type: { $in: ['fee_generated_admin', 'overtime_admin', 'registration_pending_admin'] },
    },
  ],
};

export const getNotifications = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { page, limit, skip } = parsePagination(req.query as Record<string, unknown>);
    const [notifications, total, unreadCount] = await Promise.all([
      Notification.find()
        .sort({ createdAt: -1 })
        .skip(skip)
        .limit(limit)
        .populate('user', 'name phone'),
      Notification.countDocuments(),
      Notification.countDocuments({ ...ADMIN_ALERT_FILTER, read: false }),
    ]);

    res.json({
      success: true,
      data: notifications,
      unreadCount,
      pagination: { page, limit, total, pages: Math.ceil(total / limit) },
    });
  } catch (err) {
    next(err);
  }
};

export const getFailedNotifications = async (_req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const alerts = await Notification.find(ADMIN_ALERT_FILTER)
      .sort({ updatedAt: -1, createdAt: -1 })
      .populate('user', 'name phone');
    const unreadCount = await Notification.countDocuments({
      ...ADMIN_ALERT_FILTER,
      read: false,
    });
    res.json({
      success: true,
      data: alerts,
      count: unreadCount,
      unreadCount,
      totalCount: alerts.length,
    });
  } catch (err) {
    next(err);
  }
};

/*
 * Temporarily disabled with admin overtime follow-up alerts.
 *
export const getNeedsActionNotifications = async (_req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const alerts = await Notification.find({
      type: 'overtime_admin',
      sessionId: { $ne: null },
      $or: [
        { actionStatus: 'open' },
        { actionStatus: { $exists: false } },
        { actionStatus: null },
      ],
    })
      .sort({ createdAt: -1 })
      .populate({
        path: 'sessionId',
        select: 'status shiftEndsAt seat',
        populate: { path: 'seat', select: 'number' },
      });

    const now = Date.now();
    const data = alerts.map((alert) => {
      const session = alert.sessionId as unknown as {
        status?: string;
        shiftEndsAt?: Date;
        seat?: { number: number } | null;
      } | null;
      if (session?.status !== 'active') return null;
      return {
        _id: alert._id,
        studentName: alert.studentNameSnapshot ?? 'Unknown',
        phone: alert.studentPhoneSnapshot,
        seatNumber: session?.seat?.number ?? null,
        minutesOver: session?.shiftEndsAt
          ? Math.max(0, Math.floor((now - session.shiftEndsAt.getTime()) / 60000))
          : null,
        createdAt: alert.createdAt,
      };
    }).filter((alert): alert is NonNullable<typeof alert> => alert !== null);

    res.json({ success: true, data, count: data.length });
  } catch (err) {
    next(err);
  }
};

const contactNotificationSchema = z.object({
  method: z.enum(['whatsapp', 'sms', 'call']),
});

export const markNotificationContacted = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { method } = contactNotificationSchema.parse(req.body);
    const now = new Date();
    const notification = await Notification.findOneAndUpdate(
      {
        _id: req.params.id,
        type: 'overtime_admin',
        $or: [
          { actionStatus: 'open' },
          { actionStatus: { $exists: false } },
          { actionStatus: null },
        ],
      },
      {
        $set: {
          actionStatus: 'contacted',
          contactedAt: now,
          contactMethod: method,
          contactedBy: req.user!._id,
        },
      },
      { new: true }
    );

    if (notification) {
      res.json({ success: true, message: 'Contact attempt recorded.', data: notification });
      return;
    }

    const existing = await Notification.findById(req.params.id);
    if (!existing || existing.type !== 'overtime_admin') {
      throw createError('Overtime alert not found.', 404);
    }
    if (existing.actionStatus === 'contacted') {
      res.json({ success: true, message: 'Contact attempt was already recorded.', data: existing });
      return;
    }
    throw createError('This overtime alert is already resolved.', 409);
  } catch (err) {
    next(err);
  }
};
*/

export const getUnreadNotificationCount = async (_req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const unreadCount = await Notification.countDocuments({
      ...ADMIN_ALERT_FILTER,
      read: false,
    });
    res.json({ success: true, count: unreadCount, unreadCount });
  } catch (err) {
    next(err);
  }
};

export const markAllNotificationsRead = async (_req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const now = new Date();
    const result = await Notification.updateMany(
      { ...ADMIN_ALERT_FILTER, read: false },
      { $set: { read: true, readAt: now } }
    );
    res.json({
      success: true,
      message: 'All notifications marked as read.',
      modifiedCount: result.modifiedCount,
    });
  } catch (err) {
    next(err);
  }
};

export const markNotificationRead = async (req: AuthRequest, res: Response, next: NextFunction): Promise<void> => {
  try {
    const notification = await Notification.findByIdAndUpdate(
      req.params.id,
      { read: true, readAt: new Date() },
      { new: true }
    ).populate('user', 'name phone');

    if (!notification) throw createError('Notification not found.', 404);
    res.json({ success: true, message: 'Notification marked as read.', data: notification });
  } catch (err) {
    next(err);
  }
};
