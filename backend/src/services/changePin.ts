import bcrypt from 'bcryptjs';
import mongoose from 'mongoose';
import { User, IUser } from '../models/User';
import { createError } from '../middleware/errorHandler';

export async function loadUserWithVerifiedPin(userId: mongoose.Types.ObjectId, currentPin: string): Promise<IUser> {
  const user = await User.findById(userId).select('+pinHash +tokenVersion');
  if (!user) throw createError('User not found.', 404);
  if (!(await user.comparePin(currentPin))) {
    throw createError('Current PIN is incorrect.', 401);
  }
  return user;
}

export async function setUserPin(user: IUser, newPin: string, invalidateSessions = false): Promise<void> {
  const update: {
    $set: { pinHash: string };
    $inc?: { tokenVersion: number };
  } = {
    $set: { pinHash: await bcrypt.hash(newPin, 12) },
  };
  if (invalidateSessions) update.$inc = { tokenVersion: 1 };

  const result = await User.updateOne(
    { _id: user._id, pinHash: user.pinHash },
    update
  );
  if (result.matchedCount !== 1) {
    throw createError('Your account changed during this request. Please try again.', 409);
  }
}

export async function changeUserPin(
  userId: mongoose.Types.ObjectId,
  currentPin: string,
  newPin: string,
  invalidateSessions = false
): Promise<void> {
  const user = await loadUserWithVerifiedPin(userId, currentPin);
  await setUserPin(user, newPin, invalidateSessions);
}
