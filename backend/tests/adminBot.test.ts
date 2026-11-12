/**
 * Admin bot tests — built incrementally per implementation steps.
 *
 * Covers:
 *  - Step (a): Phone normalizer & WhatsApp link generator
 *  - Step (c): Admin authorization (requireLinkedAdmin) & commands (/help, /live, /overtime)
 */

import { describe, it, expect, beforeAll, afterAll } from '@jest/globals';
import request from 'supertest';
import mongoose from 'mongoose';
import dns from 'dns';
import { randomInt } from 'crypto';
import bcrypt from 'bcryptjs';
import app from '../src/app';
import { normalizeIndianPhone, buildWhatsAppUrl } from '../src/utils/phone';
import {
  requireLinkedAdmin,
  handleHelp,
  handleLive,
  handlePending,
  handleUnpaidFees,
  handleAdminMenu,
  menuInlineKeyboard,
  handleOvertime,
  buildOvertimeAlertText,
  buildOvertimeKeyboard,
  recordManualNotificationSent,
  performForceCheckout,
  handleBotCallbackQuery,
  callbackData,
  escapeHtml,
  splitIntoChunks,
  ADMIN_REFUSAL_MESSAGE,
  ADMIN_KEYBOARD_ROWS,
} from '../src/services/notifications/adminBotHandlers';
import { handleTelegramUpdate } from '../src/services/notifications/telegramUpdates';
import { runShiftMonitor } from '../src/jobs/shiftMonitor';
import { processQueuedNotifications } from '../src/jobs/notificationWorker';
import { User } from '../src/models/User';
import { Seat } from '../src/models/Seat';
import { Session } from '../src/models/Session';
import { Notification } from '../src/models/Notification';
import { Fee } from '../src/models/Fee';
import { config } from '../src/config';
import { getAssignableSeatNumbers } from '../src/utils/seatAssignments';
import { previousMonthString, toMonthString } from '../src/utils/time';

dns.setServers(['8.8.8.8', '8.8.4.4']);

let testPhones: string[] = [];
const testUserIds: string[] = [];
const testSessionIds: string[] = [];
const testNotificationIds: string[] = [];
const testCreatedSeatIds: string[] = [];

async function createUniqueTestPhones(count: number): Promise<string[]> {
  const phones: string[] = [];
  while (phones.length < count) {
    const phone = `9${randomInt(100000000, 1000000000)}`;
    if (phones.includes(phone) || (await User.exists({ phone }))) continue;
    phones.push(phone);
  }
  return phones;
}

async function acquireAvailableSeats(count: number): Promise<any[]> {
  const occupiedSeatIds = new Set(
    (await Session.distinct('seat', { status: 'active' })).map(String)
  );
  const availableSeats = await Seat.find({ isActive: true }).sort({ number: 1 });
  const selected = availableSeats.filter((seat) => !occupiedSeatIds.has(seat._id.toString()));

  if (selected.length >= count) return selected.slice(0, count);

  const existingNumbers = new Set(await Seat.distinct('number'));
  for (let number = 1; number <= 70 && selected.length < count; number++) {
    if (existingNumbers.has(number)) continue;
    const seat = await Seat.create({ number, isActive: true });
    testCreatedSeatIds.push(seat._id.toString());
    selected.push(seat);
  }

  if (selected.length < count) {
    throw new Error(`Could not find ${count} available test seats.`);
  }
  return selected.slice(0, count);
}

async function clearTestNotificationsForSession(sessionId: string): Promise<void> {
  const notifications = await Notification.find({ sessionId }).select('_id');
  await Notification.deleteMany({
    _id: { $in: notifications.map((notification) => notification._id) },
  });
}

// ─── Step (a): Phone normalizer ─────────────────────────────────────────────

describe('normalizeIndianPhone', () => {
  it.each([
    ['9876543210', '9876543210'],
    ['+919876543210', '9876543210'],
    ['00919876543210', '9876543210'],
    ['919876543210', '9876543210'],
    ['09876543210', '9876543210'],
    [' 98765-43210 ', '9876543210'],
    ['98765.43210', '9876543210'],
    ['6000000000', '6000000000'],
    ['7999999999', '7999999999'],
    ['8888888888', '8888888888'],
  ])('normalises %s → %s', (input, expected) => {
    expect(normalizeIndianPhone(input)).toBe(expected);
  });

  it.each([
    [null, null],
    [undefined, null],
    ['', null],
    ['1234567890', null],
    ['5000000000', null],
    ['98765432', null],
    ['987654321012', null],
    ['abcdefghij', null],
    ['0000000000', null],
  ])('returns null for %s', (input, expected) => {
    expect(normalizeIndianPhone(input as string | null | undefined)).toBe(expected);
  });
});

describe('buildWhatsAppUrl', () => {
  it('builds a valid wa.me URL for a valid phone', () => {
    const url = buildWhatsAppUrl('9876543210', 'Hello, please check out.');
    expect(url).toBe(
      'https://wa.me/919876543210?text=' + encodeURIComponent('Hello, please check out.')
    );
  });

  it('normalises +91 prefix before building the URL', () => {
    const url = buildWhatsAppUrl('+919876543210', 'Hi');
    expect(url).toMatch(/^https:\/\/wa\.me\/919876543210\?text=/);
  });

  it('returns null for an invalid phone', () => {
    expect(buildWhatsAppUrl('123', 'msg')).toBeNull();
    expect(buildWhatsAppUrl(null, 'msg')).toBeNull();
    expect(buildWhatsAppUrl(undefined, 'msg')).toBeNull();
  });
});

describe('escapeHtml & splitIntoChunks', () => {
  it('escapes HTML special characters properly', () => {
    expect(escapeHtml('<script>alert("xss & fun")</script>')).toBe(
      '&lt;script&gt;alert("xss &amp; fun")&lt;/script&gt;'
    );
  });

  it('splits long text into chunks under maxLen', () => {
    const line = 'Line of text here\n';
    const longText = line.repeat(300); // ~5400 chars
    const chunks = splitIntoChunks(longText, 2000);
    expect(chunks.length).toBeGreaterThan(1);
    for (const chunk of chunks) {
      expect(chunk.length).toBeLessThanOrEqual(2000);
    }
  });

  it('keeps callback data within Telegram limits and rejects oversized values', () => {
    expect(Buffer.byteLength(callbackData('fee_paid', 'a'.repeat(50)), 'utf8')).toBeLessThanOrEqual(64);
    expect(() => callbackData('fee_paid', 'a'.repeat(60))).toThrow('must not exceed 64 bytes');
  });
});

// ─── Step (c): Authorization & Command Handlers ──────────────────────────────

describe('Admin Bot Authorization & Commands (DB)', () => {
  const linkedAdminChatId = String(randomInt(100000000, 1000000000));
  const unlinkedChatId = String(randomInt(100000000, 1000000000));
  const blockedAdminChatId = String(randomInt(100000000, 1000000000));
  const deletedAdminChatId = String(randomInt(100000000, 1000000000));
  const studentChatId = String(randomInt(100000000, 1000000000));
  const rejectedAdminChatId = String(randomInt(100000000, 1000000000));

  let testAdminUser: any;
  let testStudentUser: any;
  let testSeat1: any;
  let testSeat2: any;
  let activeSession1: any;
  let overtimeSession2: any;
  let adminCookie: string;

  beforeAll(async () => {
    if (mongoose.connection.readyState === 0) {
      await mongoose.connect(config.mongoUri, { serverSelectionTimeoutMS: 15000 });
    }

    testPhones = await createUniqueTestPhones(9);
    const pinHash = await bcrypt.hash('123456', 10);
    [testSeat1, testSeat2] = await acquireAvailableSeats(2);

    // 1. Authorized linked admin
    testAdminUser = await User.create({
      name: 'Authorized Admin',
      phone: testPhones[0],
      email: `${testPhones[0]}@example.test`,
      pinHash,
      role: 'admin',
      status: 'approved',
      telegramChatId: linkedAdminChatId,
      telegramLinkedAt: new Date(),
    });
    testUserIds.push(testAdminUser._id.toString());

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ phone: testPhones[0], pin: '123456' });
    adminCookie = loginRes.headers['set-cookie']?.[0] || '';

    // 2. Blocked admin
    const blockedAdmin = await User.create({
      name: 'Blocked Admin',
      phone: testPhones[1],
      email: `${testPhones[1]}@example.test`,
      pinHash,
      role: 'admin',
      status: 'blocked',
      telegramChatId: blockedAdminChatId,
      telegramLinkedAt: new Date(),
    });
    testUserIds.push(blockedAdmin._id.toString());

    // 3. Soft-deleted admin
    const deletedAdmin = await User.create({
      name: 'Deleted Admin',
      phone: testPhones[2],
      email: `${testPhones[2]}@example.test`,
      pinHash,
      role: 'admin',
      status: 'approved',
      isDeleted: true,
      telegramChatId: deletedAdminChatId,
      telegramLinkedAt: new Date(),
    });
    testUserIds.push(deletedAdmin._id.toString());

    // 4. Student 1
    testStudentUser = await User.create({
      name: 'John <Doe> & Friends',
      phone: testPhones[3],
      pinHash,
      role: 'student',
      status: 'approved',
      telegramChatId: studentChatId,
      telegramLinkedAt: new Date(),
    });
    testUserIds.push(testStudentUser._id.toString());

    // 4b. Student 2 (for second session)
    const testStudentUser2 = await User.create({
      name: 'Overtime Student',
      phone: testPhones[5],
      pinHash,
      role: 'student',
      status: 'approved',
    });
    testUserIds.push(testStudentUser2._id.toString());

    // 5. Rejected admin
    const rejectedAdmin = await User.create({
      name: 'Rejected Admin',
      phone: testPhones[4],
      email: `${testPhones[4]}@example.test`,
      pinHash,
      role: 'admin',
      status: 'rejected',
      telegramChatId: rejectedAdminChatId,
      telegramLinkedAt: new Date(),
    });
    testUserIds.push(rejectedAdmin._id.toString());

    // Active session (not overtime, 2h left)
    activeSession1 = await Session.create({
      student: testStudentUser._id,
      seat: testSeat1._id,
      shiftHours: 4,
      checkInAt: new Date(Date.now() - 2 * 3600000),
      shiftEndsAt: new Date(Date.now() + 2 * 3600000),
      status: 'active',
    });
    testSessionIds.push(activeSession1._id.toString());

    // Active session in overtime (ended 25 minutes ago)
    overtimeSession2 = await Session.create({
      student: testStudentUser2._id,
      seat: testSeat2._id,
      shiftHours: 12,
      checkInAt: new Date(Date.now() - 13 * 3600000),
      shiftEndsAt: new Date(Date.now() - 25 * 60000),
      status: 'active',
    });
    testSessionIds.push(overtimeSession2._id.toString());
  });

  afterAll(async () => {
    const sessionNotifications = await Notification.find({
      sessionId: { $in: testSessionIds },
    }).select('_id');
    const notificationIds = new Set([
      ...testNotificationIds,
      ...sessionNotifications.map((notification) => notification._id.toString()),
    ]);
    await Notification.deleteMany({
      _id: { $in: [...notificationIds] },
    });
    await Session.deleteMany({ _id: { $in: testSessionIds } });
    await User.deleteMany({ _id: { $in: testUserIds } });
    await Seat.deleteMany({ _id: { $in: testCreatedSeatIds } });
  });

  describe('requireLinkedAdmin Authorization', () => {
    it('approves an active, approved, non-deleted admin in a private chat', async () => {
      const admin = await requireLinkedAdmin(linkedAdminChatId, 'private');
      expect(admin).not.toBeNull();
      expect(admin?.role).toBe('admin');
      expect(admin?.name).toBe('Authorized Admin');
    });

    it('rejects an unknown chatId with null', async () => {
      const result = await requireLinkedAdmin(unlinkedChatId, 'private');
      expect(result).toBeNull();
    });

    it('rejects a student with linked chatId', async () => {
      const result = await requireLinkedAdmin(studentChatId, 'private');
      expect(result).toBeNull();
    });

    it('rejects a blocked admin', async () => {
      const result = await requireLinkedAdmin(blockedAdminChatId, 'private');
      expect(result).toBeNull();
    });

    it('rejects a soft-deleted admin', async () => {
      const result = await requireLinkedAdmin(deletedAdminChatId, 'private');
      expect(result).toBeNull();
    });

    it('rejects a rejected admin', async () => {
      const result = await requireLinkedAdmin(rejectedAdminChatId, 'private');
      expect(result).toBeNull();
    });

    it('rejects group or supergroup chats silently', async () => {
      expect(await requireLinkedAdmin(linkedAdminChatId, 'group')).toBeNull();
      expect(await requireLinkedAdmin(linkedAdminChatId, 'supergroup')).toBeNull();
    });
  });

  describe('Commands via handleTelegramUpdate', () => {
    it('refuses unauthorized users on /live politely with no data leaked', async () => {
      const sent: string[] = [];
      await handleTelegramUpdate(
        { message: { text: '/live', chat: { id: unlinkedChatId, type: 'private' } } },
        async (_cid, text) => {
          sent.push(text);
        }
      );
      expect(sent).toEqual([ADMIN_REFUSAL_MESSAGE]);
      expect(sent[0]).not.toContain('John');
      expect(sent[0]).not.toContain('Seat');
    });

    it.each(['/menu', '/pending', '/unpaid'])(
      'refuses unauthorized users on %s',
      async (command) => {
        const sent: string[] = [];
        await handleTelegramUpdate(
          { message: { text: command, chat: { id: unlinkedChatId, type: 'private' } } },
          async (_cid, text) => { sent.push(text); }
        );
        expect(sent).toEqual([ADMIN_REFUSAL_MESSAGE]);
      }
    );

    it('refuses a student user on /overtime', async () => {
      const sent: string[] = [];
      await handleTelegramUpdate(
        { message: { text: '/overtime', chat: { id: studentChatId, type: 'private' } } },
        async (_cid, text) => {
          sent.push(text);
        }
      );
      expect(sent).toEqual([ADMIN_REFUSAL_MESSAGE]);
    });

    it('replies politely to admin commands sent from a group chat', async () => {
      const sent: string[] = [];
      await handleTelegramUpdate(
        { message: { text: '/live', chat: { id: linkedAdminChatId, type: 'group' } } },
        async (_cid, text) => { sent.push(text); }
      );
      expect(sent).toEqual([ADMIN_REFUSAL_MESSAGE]);
    });

    it('responds to /help with command list', async () => {
      const sent: string[] = [];
      await handleTelegramUpdate(
        { message: { text: '/help', chat: { id: linkedAdminChatId, type: 'private' } } },
        async (_cid, text) => {
          sent.push(text);
        }
      );
      expect(sent[0]).toContain('/live');
      expect(sent[0]).toContain('/overtime');
    });

    it('shows the persistent admin menu only to linked admins', async () => {
      const sent: string[] = [];
      await handleTelegramUpdate(
        { message: { text: '/menu', chat: { id: linkedAdminChatId, type: 'private' } } },
        async (_cid, text) => { sent.push(text); }
      );
      expect(sent).toContain('Admin control panel:');
      expect(ADMIN_KEYBOARD_ROWS).toEqual([
        ['👥 Live seats', '⏱ Overtime'],
        ['📝 Pending requests', '💰 Unpaid fees'],
      ]);
    });

    it('handles /live with current counts and escaped names', async () => {
      const activeCount = await Session.countDocuments({ status: 'active' });
      const overtimeCount = await Session.countDocuments({
        status: 'active',
        shiftEndsAt: { $lt: new Date() },
      });
      const sent: string[] = [];
      await handleTelegramUpdate(
        { message: { text: '/live', chat: { id: linkedAdminChatId, type: 'private' } } },
        async (_cid, text) => {
          sent.push(text);
        }
      );
      expect(sent.length).toBeGreaterThanOrEqual(1);
      const combined = sent.join('\n');
      expect(combined).toContain('Live Study Status');
      expect(combined).toContain(`Checked in: ${activeCount} · Overtime: ${overtimeCount} · Free: ${70 - activeCount}`);
      expect(combined).toContain('John &lt;Doe&gt; &amp; Friends');
      expect(combined).toContain(`Seat ${testSeat1.number}`);
    });

    it('adds an inline Refresh button to /live output', async () => {
      let keyboard: any;
      await handleLive(
        linkedAdminChatId,
        async (_cid, _text, buttons) => {
          keyboard = buttons;
          return { ok: true };
        }
      );
      expect(keyboard?.[0]?.[0]?.callback_data).toBe('live_refresh:0');
      expect(keyboard?.[1]?.[0]?.callback_data).toBe('menu:0');
    });

    it('renders the inline menu and persistent admin reply keyboard', async () => {
      let inline: any;
      let replyRows: string[][] = [];
      await handleAdminMenu(
        linkedAdminChatId,
        async (_cid, _text, keyboard) => {
          inline = keyboard;
          return { ok: true };
        },
        async (_cid, _text, rows) => {
          replyRows = rows;
          return { ok: true };
        }
      );
      expect(inline).toEqual(menuInlineKeyboard());
      expect(inline.flat().map((button: any) => button.text)).toEqual([
        '👥 Live seats',
        '⏱ Overtime',
        '📝 Pending requests',
        '💰 Unpaid fees',
      ]);
      expect(replyRows).toEqual(ADMIN_KEYBOARD_ROWS);
    });

    it('maps reply-keyboard "👥 Live seats" button text to /live', async () => {
      const sent: string[] = [];
      await handleTelegramUpdate(
        { message: { text: '👥 Live seats', chat: { id: linkedAdminChatId, type: 'private' } } },
        async (_cid, text) => {
          sent.push(text);
        }
      );
      expect(sent[0]).toContain('Live Study Status');
    });

    it('lists pending registrations with approve and reject actions', async () => {
      const pending = await User.create({
        name: 'Pending Telegram Student',
        phone: testPhones[6],
        role: 'student',
        status: 'pending',
      });
      testUserIds.push(pending._id.toString());
      const sent: string[] = [];
      let keyboard: any;
      try {
        await handleTelegramUpdate(
          { message: { text: '/pending', chat: { id: linkedAdminChatId, type: 'private' } } },
          async (_cid, text) => { sent.push(text); }
        );
        await handlePending(
          linkedAdminChatId,
          async (_cid, _text, buttons) => {
            keyboard = buttons;
            return { ok: true };
          }
        );
        expect(sent.join('\n')).toContain('Pending Telegram Student');
        expect(keyboard?.flat().map((button: any) => button.callback_data)).toContain(
          `student_approve:${pending._id}`
        );
        expect(keyboard?.flat().map((button: any) => button.callback_data)).toContain(
          `student_reject:${pending._id}`
        );
      } finally {
        await User.deleteOne({ _id: pending._id });
      }
    });

    it('lists unpaid fees and includes their pending total', async () => {
      const fee = await Fee.create({
        student: testStudentUser._id,
        month: toMonthString(new Date()),
        amount: 1250,
        status: 'unpaid',
      });
      const sent: string[] = [];
      let keyboards: any[] = [];
      try {
        const [summary] = await Fee.aggregate<{ total: number }>([
          { $match: { status: 'unpaid', month: { $in: [toMonthString(new Date()), previousMonthString()] } } },
          { $group: { _id: null, total: { $sum: '$amount' } } },
        ]);
        await handleTelegramUpdate(
          { message: { text: '/unpaid', chat: { id: linkedAdminChatId, type: 'private' } } },
          async (_cid, text) => { sent.push(text); }
        );
        await handleUnpaidFees(
          linkedAdminChatId,
          async (_cid, _text, keyboard) => {
            keyboards.push(keyboard);
            return { ok: true };
          }
        );
        expect(sent.join('\n')).toContain(
          `Total pending: ₹${(summary?.total ?? 0).toLocaleString('en-IN')}`
        );
        expect(sent.join('\n')).toContain('John &lt;Doe&gt;');
        const callbackDataValues = keyboards.flat(2)
          .filter(Boolean)
          .map((button: any) => button.callback_data)
          .filter(Boolean);
        expect(callbackDataValues).toContain(`fee_paid:${fee._id}`);
        expect(callbackDataValues).toContain(`fee_remind:${fee._id}`);
      } finally {
        await Fee.deleteOne({ _id: fee._id });
      }
    });

    it('approves a pending registration once and reports a race as already handled', async () => {
      const availableSeats = await getAssignableSeatNumbers();
      expect(availableSeats.length).toBeGreaterThan(0);
      const pending = await User.create({
        name: 'Approve Callback Student',
        phone: testPhones[7],
        role: 'student',
        status: 'pending',
        seatNumber: availableSeats[0],
        shiftHours: 4,
      });
      const answers: string[] = [];
      const edits: string[] = [];
      const answer = async (_id: string, text?: string) => {
        answers.push(text ?? '');
        return { ok: true };
      };
      const edit = async (_chatId: string, _messageId: number, text: string) => {
        edits.push(text);
        return { ok: true };
      };
      const update = {
        id: 'approve_once',
        from: { id: linkedAdminChatId },
        message: {
          message_id: 501,
          text: 'Pending registration',
          chat: { id: linkedAdminChatId, type: 'private' },
        },
        data: callbackData('student_approve', pending._id.toString()),
      };

      try {
        await handleBotCallbackQuery(update, answer as any, edit as any);
        await handleBotCallbackQuery(update, answer as any, edit as any);
        expect((await User.findById(pending._id))?.status).toBe('approved');
        expect(answers).toEqual(['Approved.', 'Already handled']);
        if (config.defaultMonthlyFee === 0) {
          expect(edits[0]).toContain(
            'Monthly fee is ₹0, set it on the website or no fee will be generated.'
          );
        }
      } finally {
        await Notification.deleteMany({ user: pending._id });
        await User.deleteOne({ _id: pending._id });
      }
    });

    it('requires rejection confirmation before applying the status change', async () => {
      const pending = await User.create({
        name: 'Reject Callback Student',
        phone: testPhones[8],
        role: 'student',
        status: 'pending',
      });
      let confirmationData = '';
      const answer = async () => ({ ok: true });
      const edit = async (_chatId: string, _messageId: number, _text: string, keyboard?: any) => {
        confirmationData = keyboard?.[0]?.[0]?.callback_data ?? '';
        return { ok: true };
      };

      try {
        await handleBotCallbackQuery(
          {
            id: 'reject_confirm_prompt',
            from: { id: linkedAdminChatId },
            message: {
              message_id: 502,
              text: 'Pending registration',
              chat: { id: linkedAdminChatId, type: 'private' },
            },
            data: callbackData('student_reject', pending._id.toString()),
          },
          answer as any,
          edit as any
        );
        expect(confirmationData).toBe(callbackData('student_reject_yes', pending._id.toString()));
        await handleBotCallbackQuery(
          {
            id: 'reject_confirm_yes',
            from: { id: linkedAdminChatId },
            message: {
              message_id: 502,
              text: 'Reject student?',
              chat: { id: linkedAdminChatId, type: 'private' },
            },
            data: confirmationData,
          },
          answer as any,
          edit as any
        );
        expect((await User.findById(pending._id))?.status).toBe('rejected');
      } finally {
        await Notification.deleteMany({ user: pending._id });
        await User.deleteOne({ _id: pending._id });
      }
    });

    it('marks an unpaid fee once and treats a repeated callback as already handled', async () => {
      const fee = await Fee.create({
        student: testStudentUser._id,
        month: toMonthString(new Date()),
        amount: 1100,
        status: 'unpaid',
      });
      const answers: string[] = [];
      const answer = async (_id: string, text?: string) => {
        answers.push(text ?? '');
        return { ok: true };
      };
      const edit = async () => ({ ok: true });
      const update = {
        id: 'fee_paid_callback',
        from: { id: linkedAdminChatId },
        message: {
          message_id: 503,
          text: 'Unpaid fee',
          chat: { id: linkedAdminChatId, type: 'private' },
        },
        data: callbackData('fee_paid', fee._id.toString()),
      };

      try {
        await handleBotCallbackQuery(update, answer as any, edit as any);
        await handleBotCallbackQuery(update, answer as any, edit as any);
        expect((await Fee.findById(fee._id))?.status).toBe('paid');
        expect(answers).toEqual(['Marked paid.', 'Already handled']);
      } finally {
        await Fee.deleteOne({ _id: fee._id });
      }
    });

    it('handles /overtime and shows overtime sessions with minutes over', async () => {
      const sent: string[] = [];
      await handleTelegramUpdate(
        { message: { text: '/overtime', chat: { id: linkedAdminChatId, type: 'private' } } },
        async (_cid, text) => {
          sent.push(text);
        }
      );
      expect(sent.length).toBeGreaterThanOrEqual(1);
      const combined = sent.join('\n');
      expect(combined).toContain('Students in Overtime');
      expect(combined).toContain(`Seat ${testSeat2.number}`);
      expect(combined).toContain('over');
    });

    it('maps reply-keyboard "⏰ Overtime" button text to /overtime', async () => {
      const sent: string[] = [];
      await handleTelegramUpdate(
        { message: { text: '⏰ Overtime', chat: { id: linkedAdminChatId, type: 'private' } } },
        async (_cid, text) => {
          sent.push(text);
        }
      );
      expect(sent[0]).toContain('Students in Overtime');
    });
  });

  // ─── Step (d): Overtime Alert With Buttons & Worker ────────────────────────

  describe('Step (d): Overtime alert message, keyboard & notification worker', () => {
    it('builds overtime alert message with all required fields and escaping', () => {
      const text = buildOvertimeAlertText({
        studentName: 'Aarav <Sharma>',
        seatNumber: 15,
        shiftLabel: '4-hour',
        shiftEndsAtIST: '10:30 AM',
        minutesOver: 18,
        studyingNow: 12,
        capacity: 70,
      });

      expect(text).toContain('Overtime Alert');
      expect(text).toContain('Aarav &lt;Sharma&gt;');
      expect(text).toContain('Seat 15');
      expect(text).toContain('4-hour shift');
      expect(text).toContain('Shift ended 10:30 AM');
      expect(text).toContain('18 min over');
      expect(text).toContain('Studying now: 12 / 70');
    });

    it('builds overtime keyboard with wa.me link and callbacks under 64 bytes', () => {
      const sessionId = '65b2f8a91c4d7e0012345678';
      const keyboard = buildOvertimeKeyboard({
        sessionId,
        studentPhone: '+919876543210',
        studentName: 'Priya Patel',
        shiftEndsAtIST: '11:00 AM',
      }) as Array<Array<{ text: string; url?: string; callback_data?: string }>>;

      expect(keyboard.length).toBe(2);
      // Row 1: WhatsApp button
      expect(keyboard[0][0].text).toBe('📲 WhatsApp Priya');
      expect(keyboard[0][0].url).toContain('https://wa.me/919876543210?text=');

      // Row 2: Mark as sent & Force checkout callbacks
      expect(keyboard[1][0].text).toBe('✅ Mark as sent');
      expect(keyboard[1][0].callback_data).toBe(`ot_sent:${sessionId}`);
      expect(Buffer.byteLength(keyboard[1][0].callback_data!)).toBeLessThan(64);

      expect(keyboard[1][1].text).toBe('🚪 Force checkout');
      expect(keyboard[1][1].callback_data).toBe(`ot_force:${sessionId}`);
      expect(Buffer.byteLength(keyboard[1][1].callback_data!)).toBeLessThan(64);
    });

    it('hides WhatsApp button if student phone is invalid or missing', () => {
      const sessionId = '65b2f8a91c4d7e0012345678';
      const keyboardInvalid = buildOvertimeKeyboard({
        sessionId,
        studentPhone: '12345',
        studentName: 'Rahul',
        shiftEndsAtIST: '11:00 AM',
      }) as Array<Array<{ text: string; url?: string; callback_data?: string }>>;

      expect(keyboardInvalid.length).toBe(1); // Only row with callback buttons
      expect(keyboardInvalid[0][0].text).toBe('✅ Mark as sent');
      expect(keyboardInvalid[0][1].text).toBe('🚪 Force checkout');
    });

    it('runShiftMonitor is idempotent and fires overtime alert only once per session', async () => {
      await clearTestNotificationsForSession(overtimeSession2._id.toString());
      await Session.findByIdAndUpdate(overtimeSession2._id, { 'alertsSent.overtime': false });

      // Run 1: Should enqueue overtime alert
      await runShiftMonitor({ sessionIds: [overtimeSession2._id.toString()] });
      const notifsRun1 = await Notification.find({
        sessionId: overtimeSession2._id,
        type: 'overtime_admin',
        channel: 'telegram',
      });
      expect(notifsRun1.length).toBeGreaterThanOrEqual(1);

      // Run 2: Idempotent - should NOT enqueue again
      await runShiftMonitor({ sessionIds: [overtimeSession2._id.toString()] });
      const notifsRun2 = await Notification.find({
        sessionId: overtimeSession2._id,
        type: 'overtime_admin',
        channel: 'telegram',
      });
      expect(notifsRun2.length).toBe(notifsRun1.length);
    });

    it('processQueuedNotifications loads student details from session and sends with keyboard', async () => {
      const sentMessages: Array<{ chatId: string; text: string; keyboard?: any }> = [];
      const testSender = async (chatId: string, text: string, keyboard?: any) => {
        sentMessages.push({ chatId, text, keyboard });
      };

      const testNotification = await Notification.findOne({
        sessionId: overtimeSession2._id,
        user: testAdminUser._id,
        type: 'overtime_admin',
        channel: 'telegram',
      });
      expect(testNotification).not.toBeNull();
      await processQueuedNotifications(testSender as any, {
        notificationIds: [testNotification!._id.toString()],
      });

      // Verify at least one message was sent with buttons
      const overtimeSent = sentMessages.find((m) => m.text.includes('Overtime Alert'));
      expect(overtimeSent).toBeDefined();
      expect(overtimeSent?.keyboard).toBeDefined();
      expect(overtimeSent?.keyboard.length).toBeGreaterThanOrEqual(1);
    });

    it('treats 403 (blocked bot) as permanent failure immediately without retry', async () => {
      // Create a test queued notification
      const testBlockedNotif = await Notification.create({
        user: testAdminUser._id,
        type: 'overtime_admin',
        channel: 'telegram',
        status: 'queued',
        message: 'Blocked test',
        attempts: 0,
      });
      testNotificationIds.push(testBlockedNotif._id.toString());

      const blockedSender = async () => {
        const err = new Error('bot blocked by user');
        (err as any).errorCode = 403;
        throw err;
      };

      await processQueuedNotifications(blockedSender as any, {
        notificationIds: [testBlockedNotif._id.toString()],
      });

      const updated = await Notification.findById(testBlockedNotif._id);
      expect(updated?.status).toBe('failed');
      expect(updated?.attempts).toBe(3); // Marked max attempts immediately
      expect(updated?.lastError).toContain('bot blocked by user');

      await Notification.findByIdAndDelete(testBlockedNotif._id);
    });
  });

  // ─── Step (e): Callbacks (sent, force, confirm, cancel) & Regression ────────

  describe('Step (e): Callback handling & force checkout regression', () => {
    let callbackSeat: any;
    let callbackStudent: any;
    let callbackSession: any;
    let studentManualNotif: any;

    beforeAll(async () => {
      [callbackSeat] = await acquireAvailableSeats(1);
      callbackStudent = await User.create({
        name: 'Callback <Student> & Co',
        phone: testPhones[6],
        pinHash: await bcrypt.hash('123456', 10),
        role: 'student',
        status: 'approved',
      });
      testUserIds.push(callbackStudent._id.toString());

      // Create an overtime session with a manual student notification row
      callbackSession = await Session.create({
        student: callbackStudent._id,
        seat: callbackSeat._id,
        shiftHours: 4,
        checkInAt: new Date(Date.now() - 5 * 3600000),
        shiftEndsAt: new Date(Date.now() - 30 * 60000),
        status: 'active',
      });
      testSessionIds.push(callbackSession._id.toString());

      studentManualNotif = await Notification.create({
        user: callbackStudent._id,
        sessionId: callbackSession._id,
        type: 'overtime_admin',
        channel: 'whatsapp',
        status: 'manual_pending',
        actionStatus: 'open',
        message: 'Hi, you are in overtime',
      });
      testNotificationIds.push(studentManualNotif._id.toString());
    });

    it('rejects callback if from.id does not match message.chat.id (Requirement 8)', async () => {
      let answeredText = '';
      const testAnswer = async (_id: string, text?: string) => {
        answeredText = text || '';
        return { ok: true };
      };

      await handleBotCallbackQuery(
        {
          id: 'cb_spoof_1',
          from: { id: linkedAdminChatId },
          message: {
            message_id: 101,
            text: 'Overtime Alert',
            chat: { id: '99999_different_chat', type: 'private' },
          },
          data: `ot:sent:${callbackSession._id}`,
        },
        testAnswer as any
      );

      expect(answeredText).toContain('Unauthorized');
    });

    it('rejects callback if chat is not private (Requirement 8)', async () => {
      let answeredText = '';
      const testAnswer = async (_id: string, text?: string) => {
        answeredText = text || '';
        return { ok: true };
      };

      await handleBotCallbackQuery(
        {
          id: 'cb_group_1',
          from: { id: linkedAdminChatId },
          message: {
            message_id: 102,
            text: 'Overtime Alert',
            chat: { id: linkedAdminChatId, type: 'group' },
          },
          data: `ot:sent:${callbackSession._id}`,
        },
        testAnswer as any
      );

      expect(answeredText).toContain('Unauthorized');
    });

    it('rejects callback from an unauthorized / non-admin user', async () => {
      let answeredText = '';
      const testAnswer = async (_id: string, text?: string) => {
        answeredText = text || '';
        return { ok: true };
      };

      await handleBotCallbackQuery(
        {
          id: 'cb_unauth_1',
          from: { id: studentChatId },
          message: {
            message_id: 103,
            text: 'Overtime Alert',
            chat: { id: studentChatId, type: 'private' },
          },
          data: `ot:sent:${callbackSession._id}`,
        },
        testAnswer as any
      );

      expect(answeredText).toContain('Unauthorized');
    });

    it('handles "Mark as sent" callback: updates student row, appends status and clears buttons', async () => {
      let answeredText = '';
      let editedText = '';
      let editedKeyboard: any = null;

      const testAnswer = async (_id: string, text?: string) => {
        answeredText = text || '';
        return { ok: true };
      };
      const testEdit = async (_cid: string, _mid: number, text: string, keyboard?: any) => {
        editedText = text;
        editedKeyboard = keyboard;
        return { ok: true };
      };

      await handleBotCallbackQuery(
        {
          id: 'cb_sent_1',
          from: { id: linkedAdminChatId },
          message: {
            message_id: 104,
            text: '⏰ Overtime Alert\nJohn Doe · Seat 68',
            chat: { id: linkedAdminChatId, type: 'private' },
          },
          data: `ot:sent:${callbackSession._id}`,
        },
        testAnswer as any,
        testEdit as any
      );

      // Verify answer and edit
      expect(editedText).toContain('✅ Sent by Authorized Admin');
      expect(editedKeyboard).toEqual([]); // Buttons cleared per Requirement 3

      // Verify the STUDENT notification row was updated (Requirement 1)
      const updatedNotif = await Notification.findById(studentManualNotif._id);
      expect(updatedNotif?.status).toBe('sent');
      expect(updatedNotif?.actionStatus).toBe('contacted');
      expect(updatedNotif?.contactedBy?.toString()).toBe(testAdminUser._id.toString());
      expect(updatedNotif?.contactedAt).toBeInstanceOf(Date);
    });

    it('is idempotent on double "Mark as sent": answers "Already marked by X at HH:mm"', async () => {
      let answeredText = '';
      let editedText = '';

      const testAnswer = async (_id: string, text?: string) => {
        answeredText = text || '';
        return { ok: true };
      };
      const testEdit = async (_cid: string, _mid: number, text: string) => {
        editedText = text;
        return { ok: true };
      };

      // Press "Mark as sent" a second time
      await handleBotCallbackQuery(
        {
          id: 'cb_sent_repeat',
          from: { id: linkedAdminChatId },
          message: {
            message_id: 104,
            text: '⏰ Overtime Alert\nJohn Doe · Seat 68',
            chat: { id: linkedAdminChatId, type: 'private' },
          },
          data: `ot:sent:${callbackSession._id}`,
        },
        testAnswer as any,
        testEdit as any
      );

      expect(answeredText).toContain('Already marked by Authorized Admin');
      expect(editedText).toContain('Already marked by Authorized Admin');
    });

    it('handles "Force checkout" Step 1: asks "Are you sure?" with student name & confirm/cancel buttons', async () => {
      let editedText = '';
      let editedKeyboard: any = null;

      const testAnswer = async () => ({ ok: true });
      const testEdit = async (_cid: string, _mid: number, text: string, keyboard?: any) => {
        editedText = text;
        editedKeyboard = keyboard;
        return { ok: true };
      };

      await handleBotCallbackQuery(
        {
          id: 'cb_force_req',
          from: { id: linkedAdminChatId },
          message: {
            message_id: 105,
            text: '⏰ Overtime Alert\nJohn <Doe> & Friends · Seat 68',
            chat: { id: linkedAdminChatId, type: 'private' },
          },
          data: `ot:force:${callbackSession._id}`,
        },
        testAnswer as any,
        testEdit as any
      );

      expect(editedText).toContain('Force checkout');
      expect(editedText).toContain('Are you sure?');
      expect(editedText).toContain('Callback &lt;Student&gt; &amp; Co'); // Escaped student name
      expect(editedKeyboard).toBeDefined();
      expect(editedKeyboard[0][0].callback_data).toBe(`ot_checkout_yes:${callbackSession._id}`);
      expect(editedKeyboard[0][1].callback_data).toBe(`ot_checkout_no:${callbackSession._id}`);
    });

    it('handles "Force checkout" Cancel: updates text to Cancelled and clears buttons', async () => {
      let editedText = '';
      let editedKeyboard: any = null;

      const testAnswer = async () => ({ ok: true });
      const testEdit = async (_cid: string, _mid: number, text: string, keyboard?: any) => {
        editedText = text;
        editedKeyboard = keyboard;
        return { ok: true };
      };

      await handleBotCallbackQuery(
        {
          id: 'cb_force_cancel',
          from: { id: linkedAdminChatId },
          message: {
            message_id: 105,
            text: 'Confirm prompt text',
            chat: { id: linkedAdminChatId, type: 'private' },
          },
          data: `ot:fcancel:${callbackSession._id}`,
        },
        testAnswer as any,
        testEdit as any
      );

      expect(editedText).toContain('Cancelled by Authorized Admin');
      expect(editedKeyboard).toEqual([]);
    });

    it('handles "Force checkout" Step 2 Confirm: atomically completes session and frees seat', async () => {
      let editedText = '';
      let editedKeyboard: any = null;

      const testAnswer = async () => ({ ok: true });
      const testEdit = async (_cid: string, _mid: number, text: string, keyboard?: any) => {
        editedText = text;
        editedKeyboard = keyboard;
        return { ok: true };
      };

      await handleBotCallbackQuery(
        {
          id: 'cb_force_confirm',
          from: { id: linkedAdminChatId },
          message: {
            message_id: 106,
            text: 'Confirm prompt text',
            chat: { id: linkedAdminChatId, type: 'private' },
          },
          data: `ot:fok:${callbackSession._id}`,
        },
        testAnswer as any,
        testEdit as any
      );

      expect(editedText).toContain('Checked out by Authorized Admin');
      expect(editedKeyboard).toEqual([]);

      // Verify session in DB
      const sessionAfter = await Session.findById(callbackSession._id);
      expect(sessionAfter?.status).toBe('completed');
      expect(sessionAfter?.checkoutType).toBe('forced');
      expect(sessionAfter?.checkOutAt).toBeInstanceOf(Date);
      expect(sessionAfter?.durationMinutes).toBeGreaterThan(0);
    });

    it('re-checking session on repeat force-checkout answers "already checked out"', async () => {
      let answeredText = '';
      let editedText = '';

      const testAnswer = async (_id: string, text?: string) => {
        answeredText = text || '';
        return { ok: true };
      };
      const testEdit = async (_cid: string, _mid: number, text: string) => {
        editedText = text;
        return { ok: true };
      };

      await handleBotCallbackQuery(
        {
          id: 'cb_force_already',
          from: { id: linkedAdminChatId },
          message: {
            message_id: 106,
            text: 'Some text',
            chat: { id: linkedAdminChatId, type: 'private' },
          },
          data: `ot:force:${callbackSession._id}`,
        },
        testAnswer as any,
        testEdit as any
      );

      expect(answeredText).toContain('already checked out');
      expect(editedText).toContain('already checked out');
    });

    it('Regression test: existing admin HTTP force-checkout endpoint still functions identically', async () => {
      const [regressSeat] = await acquireAvailableSeats(1);
      const regressStudent = await User.create({
        name: 'Regress Student',
        phone: testPhones[8],
        pinHash: await bcrypt.hash('123456', 10),
        role: 'student',
        status: 'approved',
      });
      testUserIds.push(regressStudent._id.toString());

      // Create a fresh active session
      const httpSession = await Session.create({
        student: regressStudent._id,
        seat: regressSeat._id,
        shiftHours: 4,
        checkInAt: new Date(Date.now() - 45 * 60000),
        shiftEndsAt: new Date(Date.now() + 3 * 3600000),
        status: 'active',
      });
      testSessionIds.push(httpSession._id.toString());

      const res = await request(app)
        .post(`/api/admin/sessions/${httpSession._id}/force-checkout`)
        .set('Cookie', adminCookie);

      expect(res.status).toBe(200);
      expect(res.body.success).toBe(true);
      expect(res.body.message).toBe('Student force-checked out.');
      expect(res.body.data.sessionId).toBe(httpSession._id.toString());
      expect(res.body.data.durationMinutes).toBeGreaterThanOrEqual(45);
      expect(res.body.data.durationFormatted).toBeTruthy();

      // Check DB
      const dbSession = await Session.findById(httpSession._id);
      expect(dbSession?.status).toBe('completed');
      expect(dbSession?.checkoutType).toBe('forced');

      // Second call must return 404 (not active)
      const res404 = await request(app)
        .post(`/api/admin/sessions/${httpSession._id}/force-checkout`)
        .set('Cookie', adminCookie);
      expect(res404.status).toBe(404);

      await Session.findByIdAndDelete(httpSession._id);
      await User.findByIdAndDelete(regressStudent._id);
      await Seat.findByIdAndDelete(regressSeat._id);
    });
  });
});
