import { Router } from 'express';
import { asyncHandler } from '../utils/asyncHandler';
import {
  isTelegramConfigured,
  isValidTelegramWebhookSecret,
} from '../controllers/telegramController';
import { connectDB } from '../db/connectDB';
import { handleTelegramUpdate } from '../services/notifications/telegramUpdates';

const router = Router();

function getTelegramUpdateType(update: unknown): string {
  if (typeof update !== 'object' || update === null || Array.isArray(update)) {
    return 'unknown';
  }

  const updateFields = update as Record<string, unknown>;
  const knownTypes = [
    'message',
    'edited_message',
    'channel_post',
    'edited_channel_post',
    'business_message',
    'edited_business_message',
    'deleted_business_messages',
    'message_reaction',
    'message_reaction_count',
    'inline_query',
    'chosen_inline_result',
    'callback_query',
    'shipping_query',
    'pre_checkout_query',
    'poll',
    'poll_answer',
    'my_chat_member',
    'chat_member',
    'chat_join_request',
    'chat_boost',
    'removed_chat_boost',
  ];

  return knownTypes.find((type) => type in updateFields) ?? 'unknown';
}

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

    const updateType = getTelegramUpdateType(req.body);
    console.info(`[TelegramWebhook] Received update type=${updateType}.`);
    try {
      await connectDB();
      await handleTelegramUpdate(req.body);
    } catch (error: unknown) {
      const errorDetails = error instanceof Error
        ? `${error.name}: ${error.message}`
        : String(error);
      console.error(
        `[TelegramWebhook] Update processing failed (type=${updateType}): ${errorDetails}`
      );
    }

    res.sendStatus(200);
  })
);

export default router;
