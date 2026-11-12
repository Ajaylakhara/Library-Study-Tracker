import { Request, Response, NextFunction } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { z } from 'zod';
import { User } from '../models/User';
import { config } from '../config';
import { createError } from '../middleware/errorHandler';
import { AuthRequest } from '../middleware/auth';
import { getAssignableSeatNumbers, assertSeatAssignable } from '../utils/seatAssignments';
import { NotificationService } from '../services/notifications/NotificationService';

// Pre-computed dummy bcrypt hash to equalize response times against timing attacks
const DUMMY_HASH = '$2a$12$e86GyPqL.M0M5V6GkKxK3uJ1E6E/eC6i6q6I2e6G5E6D6C6B6A6a6';

const registerSchema = z.object({
  name: z.string().min(2, 'Name must be at least 2 characters').max(100).trim(),
  phone: z.string().regex(/^\d{10}$/, 'Phone must be a 10-digit Indian mobile number'),
  pin: z.string().regex(/^\d{6}$/, 'PIN must be exactly 6 digits'),
  seatNumber: z.number().int().min(1).max(70),
  shiftHours: z.union([z.literal(4), z.literal(12), z.literal(24)]),
  whatsappOptIn: z.boolean().optional(),
  smsOptIn: z.boolean().optional(),
});

const loginSchema = z.object({
  phone: z.string().regex(/^\d{10}$/, 'Phone must be 10 digits'),
  pin: z.string().regex(/^\d{6}$/, 'PIN must be 6 digits'),
});

const MAX_LOGIN_ATTEMPTS = 5;
const LOGIN_LOCK_DURATION_MS = 15 * 60 * 1000;

async function recordFailedLogin(userId: string): Promise<void> {
  const lockedUntil = new Date(Date.now() + LOGIN_LOCK_DURATION_MS);
  await User.findOneAndUpdate(
    { _id: userId },
    [
      {
        $set: {
          failedAttempts: { $add: [{ $ifNull: ['$failedAttempts', 0] }, 1] },
        },
      },
      {
        $set: {
          lockedUntil: {
            $cond: [{ $gte: ['$failedAttempts', MAX_LOGIN_ATTEMPTS] }, lockedUntil, '$lockedUntil'],
          },
          failedAttempts: {
            $cond: [{ $gte: ['$failedAttempts', MAX_LOGIN_ATTEMPTS] }, 0, '$failedAttempts'],
          },
        },
      },
    ]
  );
}

function signToken(userId: string, role: string, tokenVersion: number): string {
  const expiresIn = role === 'admin' ? config.jwt.adminExpiresIn : config.jwt.studentExpiresIn;
  return jwt.sign({ userId, role, tokenVersion }, config.jwt.secret, { expiresIn } as jwt.SignOptions);
}

function setCookieToken(res: Response, token: string, role: string): void {
  const maxAge =
    role === 'admin'
      ? 24 * 60 * 60 * 1000 // 1 day
      : 30 * 24 * 60 * 60 * 1000; // 30 days

  const sameSite = config.isProduction ? 'strict' : 'lax';

  res.cookie('token', token, {
    httpOnly: true,
    sameSite,
    secure: config.isProduction,
    path: '/',
    maxAge,
  });
}

export const register = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { name, phone, pin, seatNumber, shiftHours, whatsappOptIn, smsOptIn } = registerSchema.parse(req.body);

    const existingUser = await User.findOne({ phone, isDeleted: false }).select('_id');
    if (existingUser) {
      throw createError('This phone number is already registered.', 409);
    }
    await assertSeatAssignable(seatNumber);

    const pinHash = await bcrypt.hash(pin, 12);

    const user = await User.create({
      name,
      phone,
      pinHash,
      seatNumber,
      shiftHours,
      ...(whatsappOptIn !== undefined && { whatsappOptIn }),
      ...(smsOptIn !== undefined && { smsOptIn }),
      role: 'student',
      status: 'pending',
    });

    await NotificationService.enqueueAdmin({
      type: 'registration_pending_admin',
      vars: { name: user.name, phone: user.phone ?? '' },
      studentName: user.name,
      studentPhone: user.phone,
    });

    res.status(201).json({
      success: true,
      message: 'Registration successful. Please wait for admin approval.',
      data: {
        id: user._id,
        name: user.name,
        phone: user.phone,
        seatNumber: user.seatNumber,
        shiftHours: user.shiftHours,
        status: user.status,
      },
    });
  } catch (err) {
    next(err);
  }
};

export const getRegistrationSeats = async (_req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const seats = await getAssignableSeatNumbers();
    res.json({ success: true, data: seats, count: seats.length });
  } catch (err) {
    next(err);
  }
};

/** Sign in students and admins with the same phone + PIN form. */
export const login = async (req: Request, res: Response, next: NextFunction): Promise<void> => {
  try {
    const { phone, pin } = loginSchema.parse(req.body);
    const GENERIC_ERROR = 'Phone or PIN is wrong.';

    const admin = await User.findOne({ phone, role: 'admin', isDeleted: false }).select('+pinHash +tokenVersion');
    const user = admin ?? await User.findByPhone(phone);

    if (!user || user.isDeleted) {
      await bcrypt.compare(pin, DUMMY_HASH);
      throw createError(GENERIC_ERROR, 401);
    }

    // Check lock
    if (user.lockedUntil && user.lockedUntil > new Date()) {
      const remaining = Math.ceil((user.lockedUntil.getTime() - Date.now()) / 60000);
      throw createError(
        `Account locked due to too many failed attempts. Try again in ${remaining} minute(s).`,
        429
      );
    }

    // Check PIN
    let isMatch = false;
    if (user.pinHash) {
      isMatch = await user.comparePin(pin);
    } else {
      await bcrypt.compare(pin, DUMMY_HASH);
    }
    if (!isMatch) {
      await recordFailedLogin(user._id.toString());
      throw createError(GENERIC_ERROR, 401);
    }

    // Reset lockout on success
    if (user.failedAttempts > 0 || user.lockedUntil) {
      await User.findByIdAndUpdate(user._id, { failedAttempts: 0, lockedUntil: null });
    }

    // Students must be approved to log in; admins are provisioned as approved.
    if (user.role === 'student' && user.status !== 'approved') {
      throw createError(
        user.status === 'pending'
          ? 'Your account is pending admin approval.'
          : 'Your account has been blocked or rejected.',
        403
      );
    }

    const token = signToken(user._id.toString(), user.role, user.tokenVersion ?? 0);
    setCookieToken(res, token, user.role);

    res.json({
      success: true,
      message: 'Login successful.',
      data: {
        id: user._id,
        name: user.name,
        phone: user.phone,
        seatNumber: user.seatNumber,
        shiftHours: user.shiftHours,
        role: user.role,
        status: user.status,
      },
    });
  } catch (err) {
    next(err);
  }
};

export const logout = (_req: Request, res: Response): void => {
  res.clearCookie('token', {
    httpOnly: true,
    path: '/',
    sameSite: config.isProduction ? 'strict' : 'lax',
    secure: config.isProduction,
  });
  res.json({ success: true, message: 'Logged out successfully.' });
};

export const me = async (req: AuthRequest, res: Response): Promise<void> => {
  const user = req.user!;
  res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
  res.setHeader('Pragma', 'no-cache');
  res.setHeader('Expires', '0');
  res.json({
    success: true,
    data: {
      id: user._id,
      name: user.name,
      phone: user.phone,
      role: user.role,
      status: user.status,
      monthlyFee: user.monthlyFee,
      seatNumber: user.seatNumber,
      shiftHours: user.shiftHours,
      whatsappOptIn: user.whatsappOptIn,
      smsOptIn: user.smsOptIn,
      preferredChannel: user.preferredChannel,
    },
  });
};
