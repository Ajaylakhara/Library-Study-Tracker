import { NextFunction, Response } from 'express';
import { z } from 'zod';
import { AuthRequest } from '../middleware/auth';
import { createError } from '../middleware/errorHandler';
import { User } from '../models/User';
import { loadUserWithVerifiedPin, setUserPin } from '../services/changePin';

const changePinSchema = z.object({
  currentPin: z.string().regex(/^\d{6}$/, 'Current PIN must be exactly 6 digits.'),
  newPin: z.string().regex(/^\d{6}$/, 'New PIN must be exactly 6 digits.'),
});

const changePhoneSchema = z.object({
  currentPin: z.string().regex(/^\d{6}$/, 'Current PIN must be exactly 6 digits.'),
  phone: z.string().regex(/^\d{10}$/, 'Phone must be exactly 10 digits.'),
});

function isTrivialPin(pin: string, phone: string): boolean {
  return ['123456', '000000', '111111', '123123', phone.slice(-6)].includes(pin);
}

export async function changeAdminPin(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { currentPin, newPin } = changePinSchema.parse(req.body);
    const user = await loadUserWithVerifiedPin(req.user!._id, currentPin);
    if (isTrivialPin(newPin, user.phone ?? '')) {
      throw createError('Choose a PIN that is not easy to guess.', 400);
    }

    await setUserPin(user, newPin, true);
    res.json({ success: true, message: 'PIN changed. Please sign in again on this device.' });
  } catch (error) {
    next(error);
  }
}

export async function changeAdminPhone(req: AuthRequest, res: Response, next: NextFunction): Promise<void> {
  try {
    const { currentPin, phone } = changePhoneSchema.parse(req.body);
    const user = await loadUserWithVerifiedPin(req.user!._id, currentPin);

    const existing = await User.exists({
      phone,
      isDeleted: false,
      _id: { $ne: user._id },
    });
    if (existing) throw createError('That phone number is already used by another user.', 409);

    try {
      const result = await User.updateOne(
        { _id: user._id, role: 'admin', isDeleted: false },
        { $set: { phone } }
      );
      if (result.matchedCount !== 1) {
        throw createError('Your account changed during this request. Please try again.', 409);
      }
    } catch (error) {
      if ((error as { code?: number }).code === 11000) {
        throw createError('That phone number is already used by another user.', 409);
      }
      throw error;
    }

    res.json({ success: true, message: 'Phone number updated.', data: { phone } });
  } catch (error) {
    next(error);
  }
}
