import { afterAll, beforeAll, describe, expect, it } from '@jest/globals';
import request from 'supertest';
import mongoose from 'mongoose';
import dns from 'dns';
import { randomInt } from 'crypto';
import bcrypt from 'bcryptjs';
import { createHash } from 'crypto';
import app from '../src/app';
import { config } from '../src/config';
import { User } from '../src/models/User';
import { Notification } from '../src/models/Notification';
import { NotificationService } from '../src/services/notifications/NotificationService';
import { processQueuedNotifications } from '../src/jobs/notificationWorker';
import { handleTelegramUpdate } from '../src/services/notifications/telegramUpdates';
import { sendMessage } from '../src/services/notifications/providers/telegram';
import * as database from '../src/db/connectDB';

dns.setServers(['8.8.8.8', '8.8.4.4']);

async function createUniqueTestPhones(count: number): Promise<string[]> {
  const phones: string[] = [];
  while (phones.length < count) {
    const phone = `9${randomInt(100000000, 1000000000)}`;
    if (phones.includes(phone) || (await User.exists({ phone }))) continue;
    phones.push(phone);
  }
  return phones;
}

async function createUniqueTestChatId(): Promise<string> {
  let chatId: string;
  do {
    chatId = String(randomInt(100000000, 1000000000));
  } while (await User.exists({ telegramChatId: chatId }));
  return chatId;
}

async function clearTestNotificationsForUser(userId: string): Promise<void> {
  const notifications = await Notification.find({ user: userId }).select('_id');
  await Notification.deleteMany({ _id: { $in: notifications.map((notification) => notification._id) } });
}

describe('Telegram linking', () => {
  let adminPhone: string;
  let studentPhone: string;
  const pin = '654321';
  let adminCookie: string;
  let studentCookie: string;
  let adminId: string;
  let studentId: string;
  const testUserIds: string[] = [];
  const testNotificationIds: string[] = [];
  let adminChatId: string;
  let studentChatId: string;
  let secondAdminChatId: string;
  let otherAdminChatId: string;
  let adminTestChatId: string;
  const originalBotUsername = config.telegram.botUsername;
  const originalBotToken = config.telegram.botToken;
  const originalWebhookSecret = config.telegram.webhookSecret;

  beforeAll(async () => {
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 15000 });
    }
    await User.syncIndexes();
    [adminPhone, studentPhone] = await createUniqueTestPhones(2);
    [adminChatId, studentChatId, secondAdminChatId, otherAdminChatId, adminTestChatId] =
      await Promise.all(Array.from({ length: 5 }, () => createUniqueTestChatId()));
    config.telegram.botUsername = 'test_library_bot';
    config.telegram.botToken = 'test_bot_token';
    config.telegram.webhookSecret = 'test_webhook_secret';

    const pinHash = await bcrypt.hash(pin, 10);
    const [admin, student] = await User.create([
      {
        name: 'Telegram Test Admin',
        phone: adminPhone,
        pinHash,
        role: 'admin',
        status: 'approved',
      },
      {
        name: 'Telegram Test Student',
        phone: studentPhone,
        pinHash,
        role: 'student',
        status: 'approved',
      },
    ]);
    adminId = admin._id.toString();
    studentId = student._id.toString();
    testUserIds.push(adminId, studentId);

    const [adminLogin, studentLogin] = await Promise.all([
      request(app).post('/api/auth/login').send({ phone: adminPhone, pin }),
      request(app).post('/api/auth/login').send({ phone: studentPhone, pin }),
    ]);
    adminCookie = adminLogin.headers['set-cookie']?.[0] ?? '';
    studentCookie = studentLogin.headers['set-cookie']?.[0] ?? '';
  });

  afterAll(async () => {
    config.telegram.botUsername = originalBotUsername;
    config.telegram.botToken = originalBotToken;
    config.telegram.webhookSecret = originalWebhookSecret;
    const notifications = await Notification.find({ user: { $in: testUserIds } }).select('_id');
    const notificationIds = new Set([
      ...testNotificationIds,
      ...notifications.map((notification) => notification._id.toString()),
    ]);
    await Notification.deleteMany({ _id: { $in: [...notificationIds] } });
    await User.deleteMany({ _id: { $in: testUserIds } });
    await mongoose.connection.close();
  });

  it('creates a short-lived hashed admin link and reports linked state after pipeline update', async () => {
    const linkResponse = await request(app)
      .post('/api/admin/telegram/link')
      .set('Cookie', adminCookie);

    expect(linkResponse.status).toBe(200);
    const link = linkResponse.body.data.link as string;
    expect(link).toMatch(/^https:\/\/t\.me\/test_library_bot\?start=/);
    const code = new URL(link).searchParams.get('start');
    expect(code).toMatch(/^[A-Za-z0-9_-]{20,64}$/);
    expect(JSON.stringify(linkResponse.body)).not.toContain(
      createHash('sha256').update(code!).digest('hex')
    );

    const storedBeforeLink = await User.findById(adminId)
      .select('+telegramLinkCodeHash +telegramLinkExpires')
      .lean();
    expect(storedBeforeLink?.telegramLinkCodeHash).toBe(
      createHash('sha256').update(code!).digest('hex')
    );
    expect(storedBeforeLink?.telegramLinkCodeHash).not.toBe(code);
    expect(storedBeforeLink).not.toHaveProperty('telegramLinkCode');
    expect(storedBeforeLink).not.toHaveProperty('code');
    expect(storedBeforeLink?.telegramLinkExpires?.getTime()).toBeGreaterThan(Date.now());
    expect(storedBeforeLink?.telegramLinkExpires?.getTime()).toBeLessThanOrEqual(
      Date.now() + 10 * 60 * 1000
    );

    const sent: string[] = [];
    const sendMessage = async (chatId: string, text: string) => {
      sent.push(`${chatId}:${text}`);
    };
    await handleTelegramUpdate(
      { message: { text: `/start ${code}`, chat: { id: adminChatId, type: 'private' } } },
      sendMessage
    );

    const linkedAdmin = await User.findById(adminId)
      .select('+telegramChatId +telegramLinkCodeHash +telegramLinkExpires')
      .lean();
    expect(linkedAdmin?.telegramChatId).toBe(adminChatId);
    expect(linkedAdmin?.telegramLinkedAt).toBeInstanceOf(Date);
    expect(linkedAdmin?.telegramLinkCodeHash).toBeUndefined();
    expect(linkedAdmin?.telegramLinkExpires).toBeUndefined();
    expect(sent[0]).toContain('Connected. You will now receive library alerts here.');

    const status = await request(app)
      .get('/api/admin/telegram/status')
      .set('Cookie', adminCookie);
    expect(status.body.data).toEqual({
      connected: true,
      linkedAt: linkedAdmin?.telegramLinkedAt?.toISOString(),
    });

    const repeatMessage: string[] = [];
    await handleTelegramUpdate(
      { message: { text: `/start ${code}`, chat: { id: adminChatId, type: 'private' } } },
      async (_chatId, text) => {
        repeatMessage.push(text);
      }
    );
    expect(repeatMessage[0]).toContain('wrong or expired');
  });

  it('links and unlinks a student using a one-time code', async () => {
    const linkResponse = await request(app)
      .post('/api/me/telegram/link')
      .set('Cookie', studentCookie);
    expect(linkResponse.status).toBe(200);
    const code = new URL(linkResponse.body.data.link).searchParams.get('start');

    await handleTelegramUpdate({
      message: { text: `/start ${code}`, chat: { id: studentChatId, type: 'private' } },
    }, async () => undefined);

    const student = await User.findById(studentId).select('+telegramChatId').lean();
    expect(student?.telegramChatId).toBe(studentChatId);

    const unlinkResponse = await request(app)
      .delete('/api/me/telegram')
      .set('Cookie', studentCookie);
    expect(unlinkResponse.status).toBe(200);
    const unlinked = await User.findById(studentId).select('+telegramChatId').lean();
    expect(unlinked?.telegramChatId).toBeUndefined();
    expect(unlinked?.telegramLinkedAt).toBeUndefined();
  });

  it('rejects webhook requests with an incorrect secret', async () => {
    const [wrongSecret, missingSecret] = await Promise.all([
      request(app)
      .post('/api/telegram/webhook')
      .set('X-Telegram-Bot-Api-Secret-Token', 'wrong_secret')
      .send({ message: { text: '/myid', chat: { id: 70003, type: 'private' } } }),
      request(app)
        .post('/api/telegram/webhook')
        .send({ message: { text: '/myid', chat: { id: 70003, type: 'private' } } }),
    ]);

    expect(wrongSecret.status).toBe(401);
    expect(missingSecret.status).toBe(401);
  });

  it('answers /myid with the current chat ID', async () => {
    const replies: string[] = [];
    await handleTelegramUpdate(
      { message: { text: '/myid', chat: { id: 70004, type: 'private' } } },
      async (_chatId, text) => {
        replies.push(text);
      }
    );
    expect(replies).toEqual(['Your Telegram ID: 70004']);
  });

  it('ignores group messages and prompts private users who start without a code', async () => {
    const replies: string[] = [];
    await handleTelegramUpdate(
      { message: { text: '/myid', chat: { id: 70040, type: 'group' } } },
      async (_chatId, text) => {
        replies.push(text);
      }
    );
    await handleTelegramUpdate(
      { message: { text: '/start', chat: { id: 70041, type: 'private' } } },
      async (_chatId, text) => {
        replies.push(text);
      }
    );
    expect(replies).toEqual([
      'Open the library web app and press Connect Telegram to link this chat.',
    ]);
  });

  it('rejects unknown codes and does not consume an admin code when another admin owns the chat', async () => {
    const wrongCodeReplies: string[] = [];
    await handleTelegramUpdate(
      { message: { text: '/start wrong_code_that_is_long_enough', chat: { id: 70042, type: 'private' } } },
      async (_chatId, text) => {
        wrongCodeReplies.push(text);
      }
    );
    expect(wrongCodeReplies).toEqual([
      'This link is wrong or expired. Create a new one in the app.',
    ]);

    await User.findByIdAndUpdate(adminId, {
      telegramChatId: otherAdminChatId,
      telegramLinkedAt: new Date(),
    });
    const [otherAdminPhone] = await createUniqueTestPhones(1);
    const otherAdminWithChat = await User.create({
      name: 'Other Admin With Chat',
      phone: otherAdminPhone,
      email: `${otherAdminPhone}@example.test`,
      pinHash: await bcrypt.hash(pin, 10),
      role: 'admin',
      status: 'approved',
      telegramChatId: secondAdminChatId,
      telegramLinkedAt: new Date(),
    });
    testUserIds.push(otherAdminWithChat._id.toString());
    const linkResponse = await request(app)
      .post('/api/admin/telegram/link')
      .set('Cookie', adminCookie);
    const code = new URL(linkResponse.body.data.link).searchParams.get('start')!;

    const duplicateReplies: string[] = [];
    await handleTelegramUpdate(
      { message: { text: `/start ${code}`, chat: { id: secondAdminChatId, type: 'private' } } },
      async (_chatId, text) => {
        duplicateReplies.push(text);
      }
    );
    expect(duplicateReplies).toEqual([
      'This Telegram account is already linked to another user.',
    ]);
    const stillPending = await User.findById(adminId)
      .select('+telegramLinkCodeHash')
      .lean();
    expect(stillPending?.telegramLinkCodeHash).toBe(
      createHash('sha256').update(code).digest('hex')
    );
    await User.findByIdAndDelete(otherAdminWithChat._id);
  });

  it('awaits webhook processing after validating its secret', async () => {
    const originalVercel = process.env.VERCEL;
    delete process.env.VERCEL;
    let finishTelegramRequest!: () => void;
    let signalTelegramRequest!: () => void;
    const telegramRequestStarted = new Promise<void>((resolve) => {
      signalTelegramRequest = resolve;
    });
    const telegramRequestGate = new Promise<void>((resolve) => {
      finishTelegramRequest = resolve;
    });
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      signalTelegramRequest();
      await telegramRequestGate;
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    try {
      let responseReceived = false;
      const privateResponsePromise = request(app)
        .post('/api/telegram/webhook')
        .set('X-Telegram-Bot-Api-Secret-Token', config.telegram.webhookSecret)
        .send({ message: { text: '/myid', chat: { id: 70045, type: 'private' } } })
        .then((response) => {
          responseReceived = true;
          return response;
        });
      await telegramRequestStarted;
      expect(responseReceived).toBe(false);
      finishTelegramRequest();
      const privateResponse = await privateResponsePromise;
      expect(privateResponse.status).toBe(200);
      expect(fetchSpy).toHaveBeenCalledTimes(1);
      const sentBody = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string) as {
        chat_id: string;
        text: string;
      };
      expect(sentBody).toEqual({ chat_id: '70045', text: 'Your Telegram ID: 70045' });

      fetchSpy.mockClear();
      const groupResponse = await request(app)
        .post('/api/telegram/webhook')
        .set('X-Telegram-Bot-Api-Secret-Token', config.telegram.webhookSecret)
        .send({ message: { text: '/myid', chat: { id: 70046, type: 'group' } } });
      expect(groupResponse.status).toBe(200);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
      if (originalVercel === undefined) delete process.env.VERCEL;
      else process.env.VERCEL = originalVercel;
    }
  });

  it('awaits Vercel database connection and Telegram processing before acknowledging updates', async () => {
    const originalVercel = process.env.VERCEL;
    process.env.VERCEL = '1';

    let finishDatabaseConnect!: () => void;
    let signalDatabaseConnect!: () => void;
    const databaseConnectStarted = new Promise<void>((resolve) => {
      signalDatabaseConnect = resolve;
    });
    const databaseGate = new Promise<void>((resolve) => {
      finishDatabaseConnect = resolve;
    });
    let databaseReady = false;
    const connectSpy = jest.spyOn(database, 'connectDB').mockImplementation(async () => {
      signalDatabaseConnect();
      await databaseGate;
      databaseReady = true;
    });
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockImplementation(async () => {
      expect(databaseReady).toBe(true);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      });
    });
    const loggedErrors: string[] = [];
    const errorSpy = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      loggedErrors.push(args.join(' '));
    });

    try {
      const invalidSecret = await request(app)
        .post('/api/telegram/webhook')
        .set('X-Telegram-Bot-Api-Secret-Token', 'invalid')
        .send({ message: { text: '/myid', chat: { id: 70048, type: 'private' } } });
      expect(invalidSecret.status).toBe(401);
      expect(connectSpy).not.toHaveBeenCalled();

      let responseReceived = false;
      const responsePromise = request(app)
        .post('/api/telegram/webhook')
        .set('X-Telegram-Bot-Api-Secret-Token', config.telegram.webhookSecret)
        .send({ message: { text: '/myid', chat: { id: 70049, type: 'private' } } })
        .then((response) => {
          responseReceived = true;
          return response;
        });

      await databaseConnectStarted;
      expect(fetchSpy).not.toHaveBeenCalled();
      expect(responseReceived).toBe(false);
      finishDatabaseConnect();

      const response = await responsePromise;
      expect(response.status).toBe(200);
      expect(fetchSpy).toHaveBeenCalledTimes(1);

      fetchSpy.mockRejectedValueOnce(new Error('Telegram provider unavailable'));
      const failedUpdateResponse = await request(app)
        .post('/api/telegram/webhook')
        .set('X-Telegram-Bot-Api-Secret-Token', config.telegram.webhookSecret)
        .send({ message: { text: '/myid', chat: { id: 70050, type: 'private' } } });

      expect(failedUpdateResponse.status).toBe(200);
      expect(loggedErrors.join(' ')).toContain('[TelegramAPI] sendMessage failed');
      expect(loggedErrors.join(' ')).toContain('request failed (Error)');
    } finally {
      connectSpy.mockRestore();
      fetchSpy.mockRestore();
      errorSpy.mockRestore();
      if (originalVercel === undefined) delete process.env.VERCEL;
      else process.env.VERCEL = originalVercel;
    }
  });

  it('provides configured admin/student routes and protects role-specific endpoints', async () => {
    await User.findByIdAndUpdate(adminId, {
      $unset: { telegramChatId: 1, telegramLinkedAt: 1 },
    });
    const unauthenticated = await request(app).post('/api/admin/telegram/link');
    expect(unauthenticated.status).toBe(401);

    const studentOnAdmin = await request(app)
      .get('/api/admin/telegram/status')
      .set('Cookie', studentCookie);
    const adminOnStudent = await request(app)
      .get('/api/me/telegram/status')
      .set('Cookie', adminCookie);
    expect(studentOnAdmin.status).toBe(403);
    expect(adminOnStudent.status).toBe(403);

    const studentStatus = await request(app)
      .get('/api/me/telegram/status')
      .set('Cookie', studentCookie);
    expect(studentStatus.body.data).toEqual({ connected: false, linkedAt: null });

    const unlinkedTest = await request(app)
      .post('/api/admin/telegram/test')
      .set('Cookie', adminCookie);
    expect(unlinkedTest.body.data).toEqual({
      sent: false,
      reason: 'Telegram account is not linked.',
    });

    await User.findByIdAndUpdate(adminId, {
      telegramChatId: adminTestChatId,
      telegramLinkedAt: new Date(),
    });
    const fetchSpy = jest.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      })
    );
    try {
      const sentTest = await request(app)
        .post('/api/admin/telegram/test')
        .set('Cookie', adminCookie);
      expect(sentTest.body.data).toEqual({ sent: true });
      expect(JSON.parse(fetchSpy.mock.calls[0][1]?.body as string)).toEqual({
        chat_id: adminTestChatId,
        text: 'Test message from the Library Study Tracker',
      });
    } finally {
      fetchSpy.mockRestore();
    }

    const adminUnlink = await request(app)
      .delete('/api/admin/telegram')
      .set('Cookie', adminCookie);
    expect(adminUnlink.status).toBe(200);
    const adminAfterUnlink = await request(app)
      .get('/api/admin/telegram/status')
      .set('Cookie', adminCookie);
    expect(adminAfterUnlink.body.data).toEqual({ connected: false, linkedAt: null });

    const studentLink = await request(app)
      .post('/api/me/telegram/link')
      .set('Cookie', studentCookie);
    expect(studentLink.body.data.expiresAt).toBeTruthy();
    expect(studentLink.body.data.link).toContain('https://t.me/test_library_bot?start=');
  });

  it('returns 503 when Telegram is not configured while authentication and server routes still work', async () => {
    const botToken = config.telegram.botToken;
    const webhookSecret = config.telegram.webhookSecret;
    config.telegram.botToken = '';
    try {
      const linkResponse = await request(app)
        .post('/api/admin/telegram/link')
        .set('Cookie', adminCookie);
      const webhookResponse = await request(app)
        .post('/api/telegram/webhook')
        .set('X-Telegram-Bot-Api-Secret-Token', config.telegram.webhookSecret)
        .send({});
      expect(linkResponse.status).toBe(503);
      expect(linkResponse.body.message).toBe('Telegram is not configured');
      expect(webhookResponse.status).toBe(503);
      expect((await request(app).get('/health')).status).toBe(200);
    } finally {
      config.telegram.botToken = botToken;
    }

    config.telegram.webhookSecret = '';
    try {
      const linkResponse = await request(app)
        .post('/api/me/telegram/link')
        .set('Cookie', studentCookie);
      const webhookResponse = await request(app)
        .post('/api/telegram/webhook')
        .set('X-Telegram-Bot-Api-Secret-Token', webhookSecret)
        .send({});
      expect(linkResponse.status).toBe(503);
      expect(webhookResponse.status).toBe(503);
    } finally {
      config.telegram.webhookSecret = webhookSecret;
    }
  });

  it('does not log the Telegram token or webhook secret', async () => {
    const messages: string[] = [];
    const errorSpy = jest.spyOn(console, 'error').mockImplementation((...args: unknown[]) => {
      messages.push(args.join(' '));
    });
    const logSpy = jest.spyOn(console, 'log').mockImplementation((...args: unknown[]) => {
      messages.push(args.join(' '));
    });
    try {
      await handleTelegramUpdate(
        { message: { text: '/myid', chat: { id: 70047, type: 'private' } } },
        async () => {
          throw new Error(`${config.telegram.botToken} ${config.telegram.webhookSecret}`);
        }
      ).catch((error: unknown) => {
        const errorName = error instanceof Error ? error.name : 'UnknownError';
        console.error(`[TelegramWebhook] Update processing failed (${errorName}).`);
      });
      expect(messages.join(' ')).not.toContain(config.telegram.botToken);
      expect(messages.join(' ')).not.toContain(config.telegram.webhookSecret);
    } finally {
      errorSpy.mockRestore();
      logSpy.mockRestore();
    }
  });

  it('filters non-HTTPS Telegram buttons, maps blocked bots, and absorbs network errors', async () => {
    const fetchSpy = jest.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: true }), {
          status: 200,
          headers: { 'Content-Type': 'application/json' },
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ ok: false, error_code: 403 }), {
          status: 403,
          headers: { 'Content-Type': 'application/json' },
        })
      )
      .mockRejectedValueOnce(new Error(`failed ${config.telegram.botToken}`));
    try {
      expect(await sendMessage('70049', 'Hello', [
        { text: 'Secure', url: 'https://example.com' },
        { text: 'Insecure', url: 'http://example.com' },
      ])).toEqual({ ok: true });
      const requestBody = JSON.parse(fetchSpy.mock.calls[0][1]?.body as string) as {
        reply_markup: { inline_keyboard: Array<Array<{ text: string; url: string }>> };
      };
      expect(requestBody.reply_markup.inline_keyboard).toEqual([
        [{ text: 'Secure', url: 'https://example.com' }],
      ]);

      expect(await sendMessage('70049', 'Hello')).toEqual({
        ok: false,
        errorCode: 403,
        description: 'bot blocked by user',
      });
      await expect(sendMessage('70049', 'Hello')).resolves.toEqual({
        ok: false,
        description: 'Telegram API request failed.',
      });
    } finally {
      fetchSpy.mockRestore();
    }
  });

  it('rejects expired link codes and defines a role-scoped unique chat index', async () => {
    const expiredCode = 'a'.repeat(64);
    await User.findByIdAndUpdate(adminId, {
      telegramLinkCodeHash: createHash('sha256').update(expiredCode).digest('hex'),
      telegramLinkExpires: new Date(Date.now() - 1000),
    });

    const replies: string[] = [];
    await handleTelegramUpdate(
      { message: { text: `/start ${expiredCode}`, chat: { id: 70005, type: 'private' } } },
      async (_chatId, text) => {
        replies.push(text);
      }
    );
    expect(replies[0]).toContain('wrong or expired');
    expect(User.schema.indexes()).toContainEqual([
      { role: 1, telegramChatId: 1 },
      expect.objectContaining({
        unique: true,
        partialFilterExpression: { telegramChatId: { $type: 'string' } },
      }),
    ]);
  });

  it('routes student notifications by channel and persists the rendered message', async () => {
    await clearTestNotificationsForUser(studentId);
    await User.findByIdAndUpdate(studentId, {
      preferredChannel: 'whatsapp',
      $unset: { telegramChatId: 1, telegramLinkedAt: 1 },
    });

    await NotificationService.enqueue({
      userId: studentId,
      type: 'fee_unpaid',
      vars: { name: 'Telegram Test Student', amount: 500, month: '2026-10' },
    });
    let rows = await Notification.find({ user: studentId, type: 'fee_unpaid' });
    expect(rows.map((row) => [row.channel, row.status])).toEqual(
      expect.arrayContaining([
        ['inapp', 'queued'],
        ['whatsapp', 'manual_pending'],
      ])
    );
    expect(rows.find((row) => row.channel === 'whatsapp')?.message).toContain('Rs. 500');

    await clearTestNotificationsForUser(studentId);
    await NotificationService.enqueue({
      userId: studentId,
      type: 'shift_reminder',
      vars: { name: 'Telegram Test Student', shiftEndsAt: '10:00 AM' },
    });
    rows = await Notification.find({ user: studentId, type: 'shift_reminder' });
    expect(rows.map((row) => row.channel)).toEqual(['inapp']);

    await clearTestNotificationsForUser(studentId);
    await User.findByIdAndUpdate(studentId, { preferredChannel: 'sms' });
    await NotificationService.enqueue({
      userId: studentId,
      type: 'fee_unpaid',
      vars: { name: 'Telegram Test Student', amount: 500, month: '2026-10' },
    });
    rows = await Notification.find({ user: studentId, type: 'fee_unpaid' });
    expect(rows.some((row) => row.channel === 'sms' && row.status === 'manual_pending')).toBe(true);

    await clearTestNotificationsForUser(studentId);
    await User.findByIdAndUpdate(studentId, {
      preferredChannel: 'telegram',
      telegramChatId: studentChatId,
      telegramLinkedAt: new Date(),
    });
    await NotificationService.enqueue({
      userId: studentId,
      type: 'fee_unpaid',
      vars: { name: 'Telegram Test Student', amount: 500, month: '2026-10' },
    });
    rows = await Notification.find({ user: studentId, type: 'fee_unpaid' });
    expect(rows.some((row) => row.channel === 'telegram' && row.status === 'queued')).toBe(true);
    expect(rows.some((row) => row.status === 'manual_pending')).toBe(false);
  });

  it('creates in-app and Telegram admin alerts for every linked admin', async () => {
    const [secondAdminPhone] = await createUniqueTestPhones(1);
    const secondAdmin = await User.create({
      name: 'Second Telegram Admin',
      phone: secondAdminPhone,
      email: `${secondAdminPhone}@example.test`,
      pinHash: await bcrypt.hash(pin, 10),
      role: 'admin',
      status: 'approved',
      telegramChatId: secondAdminChatId,
      telegramLinkedAt: new Date(),
    });
    testUserIds.push(secondAdmin._id.toString());
    await User.findByIdAndUpdate(adminId, {
      telegramChatId: adminChatId,
      telegramLinkedAt: new Date(),
    });
    const existingIds = new Set(
      (await Notification.find({ type: 'fee_generated_admin' }).select('_id'))
        .map((notification) => notification._id.toString())
    );

    await NotificationService.enqueueAdmin({
      type: 'fee_generated_admin',
      vars: { month: '2026-10', count: 2, totalAmount: 1000 },
    });

    const createdNotifications = await Notification.find({ type: 'fee_generated_admin' }).select('_id');
    testNotificationIds.push(
      ...createdNotifications
        .filter((notification) => !existingIds.has(notification._id.toString()))
        .map((notification) => notification._id.toString())
    );
    const rows = await Notification.find({
      type: 'fee_generated_admin',
      user: { $in: [adminId, secondAdmin._id] },
    });
    expect(rows.filter((row) => row.channel === 'inapp')).toHaveLength(2);
    expect(rows.filter((row) => row.channel === 'telegram')).toHaveLength(2);
    expect(rows.every((row) => row.message.includes('Monthly fees generated'))).toBe(true);

    await User.findByIdAndDelete(secondAdmin._id);
  });

  it('lists only manual alert types, builds channel links, and marks manual messages sent', async () => {
    await clearTestNotificationsForUser(studentId);
    await User.findByIdAndUpdate(studentId, {
      preferredChannel: 'whatsapp',
      $unset: { telegramChatId: 1, telegramLinkedAt: 1 },
    });
    await NotificationService.enqueue({
      userId: studentId,
      type: 'fee_unpaid',
      vars: { name: 'Telegram Test Student', amount: 500, month: '2026-10' },
    });

    const listResponse = await request(app)
      .get('/api/admin/notifications/manual')
      .set('Cookie', adminCookie);
    expect(listResponse.status).toBe(200);
    const item = listResponse.body.data.items.find(
      (entry: { channel: string }) => entry.channel === 'whatsapp'
    );
    expect(item.link).toContain('https://wa.me/91' + studentPhone);
    expect(item.message).toContain('Rs. 500');

    const marked = await request(app)
      .patch(`/api/admin/notifications/${item.id}/mark-sent`)
      .set('Cookie', adminCookie);
    expect(marked.status).toBe(200);
    expect(marked.body.message).toContain('marked as sent');
    const remaining = await request(app)
      .get('/api/admin/notifications/manual')
      .set('Cookie', adminCookie);
    expect(remaining.body.data.items.some((entry: { id: string }) => entry.id === item.id)).toBe(false);
  });

  it('retries Telegram failures to the final failed status and never processes manual pending rows', async () => {
    await clearTestNotificationsForUser(studentId);
    await User.findByIdAndUpdate(studentId, {
      preferredChannel: 'telegram',
      telegramChatId: studentChatId,
      telegramLinkedAt: new Date(),
    });
    const telegramNotification = await Notification.create({
      user: studentId,
      type: 'fee_unpaid',
      channel: 'telegram',
      status: 'queued',
      message: 'Telegram retry test',
    });
    const manualNotification = await Notification.create({
      user: studentId,
      type: 'fee_unpaid',
      channel: 'sms',
      status: 'manual_pending',
      message: 'Manual rows must not retry',
    });

    const failSend = async () => {
      throw new Error('test Telegram failure');
    };
    await processQueuedNotifications(failSend, {
      notificationIds: [telegramNotification._id.toString()],
    });
    await processQueuedNotifications(failSend, {
      notificationIds: [telegramNotification._id.toString()],
    });
    await processQueuedNotifications(failSend, {
      notificationIds: [telegramNotification._id.toString()],
    });

    const failed = await Notification.findById(telegramNotification._id);
    expect(failed?.status).toBe('failed');
    expect(failed?.attempts).toBe(3);
    const manual = await Notification.findById(manualNotification._id);
    expect(manual?.status).toBe('manual_pending');
    expect(manual?.attempts).toBe(0);
  });
});
