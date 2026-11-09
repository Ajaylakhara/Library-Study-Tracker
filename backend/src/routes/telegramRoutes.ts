import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import {
  isTelegramConfigured,
  isValidTelegramWebhookSecret,
} from '../controllers/telegramController';
import { handleTelegramUpdate } from '../services/notifications/telegramUpdates';

const router = Router();

router.post(
  '/webhook',
  asyncHandler(async (req, res) => {
    if (!isTelegramConfigured()) {
      res.status(503).json({ success: false, message: 'Telegram is not configured' });
      return;
    }

    if (!isValidTelegramWebhookSecret(req.get('X-Telegram-Bot-Api-Secret-Token'))) {
      res.status(401).json({ success: false, message: 'Invalid Telegram webhook secret.' });
      return;
    }

    res.sendStatus(200);
    void handleTelegramUpdate(req.body).catch((error: unknown) => {
      const errorName = error instanceof Error ? error.name : 'UnknownError';
      console.error(`[TelegramWebhook] Update processing failed (${errorName}).`);
    });
  })
);

export default router;
