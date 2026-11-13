import dotenv from 'dotenv';
import path from 'path';

// Explicitly load .env from the backend root directory or current working directory
dotenv.config();
dotenv.config({ path: path.resolve(__dirname, '../.env') });

/**
 * Safely extracts the MongoDB host(s) from a connection string,
 * completely masking any credentials, passwords, or query params.
 */
export function getMongoHost(rawUri: string): string {
  try {
    const afterScheme = rawUri.replace(/^mongodb(\+srv)?:\/\//i, '');
    const withoutAuth = afterScheme.includes('@')
      ? afterScheme.slice(afterScheme.lastIndexOf('@') + 1)
      : afterScheme;
    return withoutAuth.split('/')[0].split('?')[0] || 'unknown-host';
  } catch {
    return 'unknown-host';
  }
}

/**
 * Checks if the password portion of a MongoDB URI contains unencoded special characters
 * (@, #, /, :, ?, or unescaped %).
 */
export function checkUnencodedPassword(rawUri: string): string | null {
  const schemeMatch = rawUri.match(/^mongodb(?:\+srv)?:\/\//i);
  if (!schemeMatch) return null;

  const rest = rawUri.slice(schemeMatch[0].length);
  if (!rest.includes('@')) return null;

  // Multiple @ signs indicates an unencoded @ inside username or password
  const atCount = (rest.match(/@/g) || []).length;
  if (atCount > 1) {
    return '@';
  }

  const atIndex = rest.indexOf('@');
  const userPass = rest.slice(0, atIndex);
  const colonIndex = userPass.indexOf(':');
  if (colonIndex === -1) return null; // No password present

  const rawPassword = userPass.slice(colonIndex + 1);
  const forbiddenChars = ['@', '#', '/', ':', '?'];
  for (const char of forbiddenChars) {
    if (rawPassword.includes(char)) {
      return char;
    }
  }

  // Check for unencoded % (not followed by two hex digits)
  if (/%(?![0-9a-fA-F]{2})/.test(rawPassword)) {
    return '%';
  }

  return null;
}

const rawMongoUri = (
  process.env.NODE_ENV === 'test'
    ? process.env.MONGODB_TEST_URI
    : process.env.MONGODB_URI || process.env.MONGO_URI
)?.trim();

const defaultMonthlyFee = process.env.DEFAULT_MONTHLY_FEE?.trim();
const parsedDefaultMonthlyFee = defaultMonthlyFee ? Number(defaultMonthlyFee) : 0;
if (!Number.isFinite(parsedDefaultMonthlyFee) || parsedDefaultMonthlyFee < 0) {
  throw new Error('DEFAULT_MONTHLY_FEE must be a non-negative number.');
}
const overtimeRepeatMinutes = process.env.OVERTIME_REPEAT_MINUTES?.trim();
const parsedOvertimeRepeatMinutes = overtimeRepeatMinutes ? Number(overtimeRepeatMinutes) : 0;
if (!Number.isInteger(parsedOvertimeRepeatMinutes) || parsedOvertimeRepeatMinutes < 0) {
  throw new Error('OVERTIME_REPEAT_MINUTES must be a non-negative integer.');
}

if (!rawMongoUri) {
  throw new Error(
    process.env.NODE_ENV === 'test'
      ? 'CRITICAL: MONGODB_TEST_URI is required for tests. Tests never use MONGODB_URI or MONGO_URI.'
      : 'CRITICAL: MongoDB connection URI is missing or empty. Please define MONGODB_URI (or MONGO_URI) in your backend .env file.'
  );
}

export const config = {
  port: parseInt(process.env.PORT ?? '5000', 10),
  nodeEnv: process.env.NODE_ENV ?? 'development',
  isProduction: process.env.NODE_ENV === 'production',

  mongoUri: rawMongoUri,

  jwt: {
    secret: process.env.JWT_SECRET ?? 'dev_secret_change_me_in_production_32chars!!',
    adminExpiresIn: process.env.ADMIN_JWT_EXPIRES_IN ?? '1d',
    studentExpiresIn: process.env.STUDENT_JWT_EXPIRES_IN ?? '30d',
  },

  authRateLimitMax: parseInt(process.env.AUTH_RATE_LIMIT_MAX ?? '20', 10),
  defaultMonthlyFee: parsedDefaultMonthlyFee,
  cronSecret: process.env.CRON_SECRET ?? '',
  runJobsInProcess: process.env.RUN_JOBS_IN_PROCESS?.trim().toLowerCase() !== 'false',
  overtimeRepeatMinutes: parsedOvertimeRepeatMinutes,

  // DEV ONLY: lets the client skip login by sending X-Dev-Role. Ignored in production.
  devAuthBypass: process.env.DEV_AUTH_BYPASS === 'true' && process.env.NODE_ENV !== 'production',

  clientUrl: process.env.CLIENT_URL ?? 'http://localhost:3000',
  defaultCountryCode: process.env.DEFAULT_COUNTRY_CODE ?? '+91',
  smsActionTokenSecret: process.env.SMS_ACTION_TOKEN_SECRET ?? '',

  telegram: {
    botToken: process.env.TELEGRAM_BOT_TOKEN ?? '',
    botUsername: process.env.TELEGRAM_BOT_USERNAME ?? '',
    webhookSecret: process.env.TELEGRAM_WEBHOOK_SECRET ?? '',
    publicUrl: process.env.PUBLIC_URL ?? '',
  },

  seed: {
    adminName: process.env.ADMIN_NAME ?? process.env.SEED_ADMIN_NAME ?? 'Librarian',
    adminPhone: process.env.ADMIN_PHONE ?? process.env.SEED_ADMIN_PHONE ?? '9000000000',
    adminEmail: process.env.ADMIN_EMAIL ?? '',
    adminPin: process.env.ADMIN_PIN ?? '',
  },

  notifications: {
    smsProvider: (process.env.SMS_PROVIDER ?? 'mock') as 'mock' | 'msg91',
    whatsappProvider: (process.env.WHATSAPP_PROVIDER ?? 'mock') as 'mock' | 'meta',
    // adminAlertPhone: process.env.ADMIN_ALERT_PHONE ?? '', // Overtime alerts are paused.
  },

  msg91: {
    authKey: process.env.MSG91_AUTH_KEY ?? '',
    senderId: process.env.MSG91_SENDER_ID ?? 'LIBSMS',
    templates: {
      approved: process.env.MSG91_DLT_TEMPLATE_APPROVED ?? '',
      rejected: process.env.MSG91_DLT_TEMPLATE_REJECTED ?? '',
      shift_reminder: process.env.MSG91_DLT_TEMPLATE_SHIFT_REMINDER ?? '',
      shift_ended: process.env.MSG91_DLT_TEMPLATE_SHIFT_ENDED ?? '',
      auto_checkout: process.env.MSG91_DLT_TEMPLATE_AUTO_CHECKOUT ?? '',
      fee_unpaid: process.env.MSG91_DLT_TEMPLATE_FEE_UNPAID ?? '',
      overtime_admin: process.env.MSG91_DLT_TEMPLATE_OVERTIME_ADMIN ?? '',
      fee_generated_admin: process.env.MSG91_DLT_TEMPLATE_FEE_GENERATED_ADMIN ?? '',
    },
  },

  meta: {
    token: process.env.META_WHATSAPP_TOKEN ?? '',
    phoneId: process.env.META_WHATSAPP_PHONE_ID ?? '',
    version: process.env.META_WHATSAPP_VERSION ?? 'v19.0',
  },
};
