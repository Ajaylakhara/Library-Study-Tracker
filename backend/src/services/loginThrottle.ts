import { Request } from 'express';
import { LoginThrottle } from '../models/LoginThrottle';

export const MAX_FAILURES_PER_PHONE = 5;
export const MAX_FAILURES_PER_IP = 30;
export const THROTTLE_WINDOW_MS = 15 * 60 * 1000;
export const LOCK_DURATION_MS = 15 * 60 * 1000;

/** One message for every locked-out case, so it never reveals whether a phone number exists. */
export const THROTTLE_MESSAGE = 'Too many failed attempts. Please wait 15 minutes and try again.';

/**
 * The caller's address. Behind the Vercel /api proxy the first X-Forwarded-For entry is the
 * original visitor; elsewhere Express (with `trust proxy` set) already resolves it.
 */
export function clientIp(req: Request): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (process.env.VERCEL && typeof forwarded === 'string' && forwarded.trim()) {
    return forwarded.split(',')[0].trim();
  }
  return req.ip ?? 'unknown';
}

const phoneKey = (phone: string) => `phone:${phone}`;
const ipKey = (ip: string) => `ip:${ip}`;

async function recordFailure(key: string, max: number, now: Date): Promise<void> {
  const windowEnd = new Date(now.getTime() + THROTTLE_WINDOW_MS);
  let doc = await LoginThrottle.findOneAndUpdate(
    { key, expiresAt: { $gt: now } },
    { $inc: { count: 1 } },
    { new: true }
  );
  if (!doc) {
    try {
      // No live window (new key, or an expired record MongoDB has not removed yet): start one.
      doc = await LoginThrottle.findOneAndUpdate(
        { key },
        { $set: { count: 1, lockedUntil: null, expiresAt: windowEnd } },
        { new: true, upsert: true }
      );
    } catch (error) {
      if ((error as { code?: number }).code !== 11000) throw error;
      // A parallel request created it first: count this failure on that record.
      doc = await LoginThrottle.findOneAndUpdate({ key }, { $inc: { count: 1 } }, { new: true });
    }
  }
  if (doc && doc.count >= max && !doc.lockedUntil) {
    const lockedUntil = new Date(now.getTime() + LOCK_DURATION_MS);
    await LoginThrottle.updateOne({ key }, { $set: { lockedUntil, expiresAt: lockedUntil } });
  }
}

/** True while this phone number or this address is locked out. */
export async function isLoginBlocked(phone: string, ip: string, now: Date = new Date()): Promise<boolean> {
  const locked = await LoginThrottle.exists({
    key: { $in: [phoneKey(phone), ipKey(ip)] },
    lockedUntil: { $gt: now },
  });
  return Boolean(locked);
}

/** Count a failed sign-in (wrong PIN or unknown phone) against both the phone and the address. */
export async function recordLoginFailure(phone: string, ip: string, now: Date = new Date()): Promise<void> {
  await Promise.all([
    recordFailure(phoneKey(phone), MAX_FAILURES_PER_PHONE, now),
    recordFailure(ipKey(ip), MAX_FAILURES_PER_IP, now),
  ]);
}

export async function clearLoginFailures(phone: string): Promise<void> {
  await LoginThrottle.deleteOne({ key: phoneKey(phone) });
}
