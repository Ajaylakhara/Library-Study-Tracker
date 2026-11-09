import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import bcrypt from 'bcryptjs';
import { config } from '../config';
import { User, IUser } from '../models/User';
import { createError } from './errorHandler';

export interface AuthRequest extends Request {
  user?: IUser;
}

interface JwtPayload {
  userId: string;
  role: string;
  iat: number;
  exp: number;
}

/** DEV ONLY (DEV_AUTH_BYPASS=true): act as a seeded test user chosen by the X-Dev-Role header. */
async function devUser(role: string | undefined): Promise<IUser> {
  if (role === 'admin') {
    const admin = await User.findOne({ role: 'admin' });
    if (admin) return admin;
    throw createError('No admin found. Run npm run seed.', 401);
  }
  const existing = await User.findOne({ role: 'student', phone: '9111111111' });
  if (existing) return existing;
  return User.create({
    name: 'Test Student',
    phone: '9111111111',
    pinHash: await bcrypt.hash('123456', 10),
    role: 'student',
    status: 'approved',
    monthlyFee: 1000,
  });
}

export const authenticate = async (
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> => {
  try {
    // Prevent browser and proxy caching of sensitive authenticated responses (prevents bfcache leaks)
    res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate, proxy-revalidate');
    res.setHeader('Pragma', 'no-cache');
    res.setHeader('Expires', '0');

    const token = req.cookies?.token as string | undefined;

    if (!token && config.devAuthBypass && req.header('x-dev-role')) {
      req.user = await devUser(req.header('x-dev-role'));
      return next();
    }

    if (!token) {
      throw createError('Authentication required. Please log in.', 401);
    }

    let decoded: JwtPayload;
    try {
      decoded = jwt.verify(token, config.jwt.secret) as JwtPayload;
    } catch {
      throw createError('Invalid or expired session. Please log in again.', 401);
    }

    // Re-fetch user on every request so blocked/deleted users are rejected immediately
    const user = await User.findById(decoded.userId);
    if (!user || user.isDeleted) {
      throw createError('User not found.', 401);
    }

    if (user.status === 'blocked' || user.status === 'rejected') {
      throw createError('Your account has been blocked. Please contact admin.', 403);
    }

    req.user = user;
    next();
  } catch (err) {
    next(err);
  }
};

export const requireRole = (role: 'admin' | 'student') =>
  (req: AuthRequest, _res: Response, next: NextFunction): void => {
    if (!req.user) {
      return next(createError('Authentication required.', 401));
    }
    if (req.user.role !== role) {
      return next(createError('Access denied. Insufficient permissions.', 403));
    }
    next();
  };

export const requireAdmin = requireRole('admin');
export const requireStudent = requireRole('student');
