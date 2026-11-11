import { randomBytes, createHash, timingSafeEqual } from 'crypto';
import { Response, NextFunction } from 'express';
import { AuthRequest } from '../middleware/auth';
import { User, UserRole } from '../models/User';
import { config } from '../config';
import { createError } from '../middleware/errorHandler';
import { sendMessage } from '../services/notifications/providers/telegram';
import { removeAdminChatCommands } from '../services/notifications/telegramCommands';

const LINK_CODE_TTL_MS = 10 * 60 * 1000;

function hashLinkCode(code: string): string {
  return createHash('sha256').update(code).digest('hex');
}

export function isTelegramConfigured(): boolean {
  return Boolean(config.telegram.botToken && config.telegram.webhookSecret);
}

function requireTelegramConfiguration(): void {
  if (!isTelegramConfigured()) {
    throw createError('Telegram is not configured', 503);
  }
}

async function createLink(
  req: AuthRequest,
  role: UserRole
): Promise<{ link: string; expiresAt: Date }> {
  requireTelegramConfiguration();
  const botUsername = config.telegram.botUsername.replace(/^@/, '');
  if (!botUsername) throw createError('Telegram is not configured', 503);

  const code = randomBytes(24).toString('base64url');
  const expiresAt = new Date(Date.now() + LINK_CODE_TTL_MS);
  const user = await User.findOneAndUpdate(
    { _id: req.user!._id, role },
    {
      $set: {
        telegramLinkCodeHash: hashLinkCode(code),
        telegramLinkExpires: expiresAt,
      },
    },
    { new: true }
  );
  if (!user) throw createError('User not found.', 404);

  return {
    link: `https://t.me/${botUsername}?start=${encodeURIComponent(code)}`,
    expiresAt,
  };
}

async function unlink(req: AuthRequest, role: UserRole): Promise<void> {
  requireTelegramConfiguration();
  await User.findOneAndUpdate(
    { _id: req.user!._id, role },
    {
      $unset: {
        telegramChatId: 1,
        telegramLinkedAt: 1,
        telegramLinkCodeHash: 1,
        telegramLinkExpires: 1,
      },
    }
  );
}

async function getStatus(req: AuthRequest, role: UserRole): Promise<{
  connected: boolean;
  linkedAt: Date | null;
}> {
  requireTelegramConfiguration();
  const user = await User.findOne({ _id: req.user!._id, role })
    .select('+telegramChatId telegramLinkedAt')
    .lean();
  return {
    connected: Boolean(user?.telegramChatId),
    linkedAt: user?.telegramLinkedAt ?? null,
  };
}

async function testConnection(req: AuthRequest): Promise<{ sent: boolean; reason?: string }> {
  requireTelegramConfiguration();
  const admin = await User.findOne({ _id: req.user!._id, role: 'admin' })
    .select('+telegramChatId')
    .lean();
  if (!admin?.telegramChatId) {
    return { sent: false, reason: 'Telegram account is not linked.' };
  }

  const result = await sendMessage(
    admin.telegramChatId,
    'Test message from the Library Study Tracker'
  );
  return result.ok
    ? { sent: true }
    : { sent: false, reason: result.description ?? 'Telegram message could not be sent.' };
}

export async function createAdminTelegramLink(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const data = await createLink(req, 'admin');
    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

export async function getAdminTelegramStatus(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const data = await getStatus(req, 'admin');
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

export async function deleteAdminTelegramLink(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const admin = await User.findOne({ _id: req.user!._id, role: 'admin' })
      .select('+telegramChatId')
      .lean();
    await unlink(req, 'admin');
    if (admin?.telegramChatId) await removeAdminChatCommands(admin.telegramChatId);
    res.json({ success: true, message: 'Telegram disconnected.' });
  } catch (error) {
    next(error);
  }
}

export async function testAdminTelegram(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const data = await testConnection(req);
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

export async function createStudentTelegramLink(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const data = await createLink(req, 'student');
    res.status(200).json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

export async function getStudentTelegramStatus(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    const data = await getStatus(req, 'student');
    res.json({ success: true, data });
  } catch (error) {
    next(error);
  }
}

export async function deleteStudentTelegramLink(
  req: AuthRequest,
  res: Response,
  next: NextFunction
): Promise<void> {
  try {
    await unlink(req, 'student');
    res.json({ success: true, message: 'Telegram disconnected.' });
  } catch (error) {
    next(error);
  }
}

export function isValidTelegramWebhookSecret(received: string | undefined): boolean {
  const expected = config.telegram.webhookSecret;
  if (!expected || !received) return false;
  const expectedBytes = Buffer.from(expected);
  const receivedBytes = Buffer.from(received);
  return (
    expectedBytes.length === receivedBytes.length &&
    timingSafeEqual(expectedBytes, receivedBytes)
  );
}
