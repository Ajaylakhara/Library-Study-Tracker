# 📚 Library Study Tracker — Backend API

A production-grade Node.js + TypeScript + Express + MongoDB REST API for managing a library study tracker with up to 70 seats, student sessions, fee management, and WhatsApp/SMS notifications.

---

## 🏗️ Project Structure

```
server/
├── src/
│   ├── config.ts                  # Env vars & typed config
│   ├── app.ts                     # Express app (no server binding)
│   ├── server.ts                  # Entry point: DB connect + server start
│   ├── seed.ts                    # Seed 70 seats + admin user
│   ├── models/
│   │   ├── User.ts                # Student & Admin (single collection)
│   │   ├── Seat.ts                # Seats 1–70
│   │   ├── Session.ts             # Check-in/check-out sessions
│   │   ├── Fee.ts                 # Monthly fees
│   │   └── Notification.ts       # Outbox for SMS/WhatsApp/in-app
│   ├── controllers/
│   │   ├── authController.ts      # Register, login (lockout), logout, me
│   │   ├── studentController.ts   # Student self-service APIs
│   │   └── adminController.ts     # Admin management APIs
│   ├── routes/
│   │   ├── authRoutes.ts          # /api/auth/*
│   │   ├── studentRoutes.ts       # /api/me/*
│   │   └── adminRoutes.ts         # /api/admin/*
│   ├── middleware/
│   │   ├── auth.ts                # JWT auth + role guards
│   │   └── errorHandler.ts        # Central error handler
│   ├── services/notifications/
│   │   ├── NotificationService.ts # Enqueue notifications
│   │   ├── templates.ts           # Message templates
│   │   └── providers/
│   │       ├── interface.ts       # INotificationProvider
│   │       ├── mockProvider.ts    # Dev: console.log
│   │       ├── smsProvider.ts     # MSG91 SMS
│   │       └── whatsappProvider.ts # Meta WhatsApp Cloud API
│   ├── jobs/
│   │   ├── index.ts               # cron scheduler
│   │   ├── shiftMonitor.ts        # Reminder/overtime/auto-checkout (every 1 min)
│   │   ├── monthlyFees.ts         # Fee generation (1st of month)
│   │   └── notificationWorker.ts  # Send queued notifications (every 30s)
│   └── utils/
│       ├── asyncHandler.ts        # Wrap async route handlers
│       ├── time.ts                # IST timezone utilities
│       └── csv.ts                 # CSV export builder
└── tests/
    ├── testHelpers.ts             # DB setup + factory functions
    ├── seat.test.ts               # Seat conflict & double checkout tests
    ├── auth.test.ts               # Role checks, blocked user, login lockout
    ├── shiftMonitor.test.ts       # Shift job idempotency tests
    └── fees.test.ts               # Monthly fee & notification tests
```

---

## ⚡ Quick Start

### Prerequisites
- Node.js ≥ 18
- MongoDB (local or Atlas)

### 1. Setup

```bash
cd server
cp .env.example .env
# Edit .env with your MongoDB URI and settings
npm install
```

### 2. Seed Database

Creates 70 seats and one admin account. Safe to run multiple times.

```bash
npm run seed
```

To update the admin phone and PIN without putting credentials in a file, run this from `backend/`:

```bash
npm run admin:update -- --phone 9876543210 --pin 482913 [--old-phone 9000000000]
```

If `--old-phone` is omitted, there must be exactly one active admin. Existing admin JWT sessions remain valid until they expire (one day).

### 3. Run Development Server

```bash
npm run dev
```

Server starts on `http://localhost:5000`

### 4. Run Tests

```bash
npm test
```

> Tests use a separate `library_study_tracker_test` database and drop it after each run.

### 5. Build for Production

```bash
npm run build
npm start
```

---

## 🔑 Environment Variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `5000` | Server port |
| `MONGODB_URI` | `mongodb://localhost/library_study_tracker` | MongoDB connection URI |
| `JWT_SECRET` | *(required in prod)* | Secret key for JWT signing |
| `CLIENT_URL` | `http://localhost:3000` | CORS allowed origin |
| `ADMIN_PHONE` | `9000000000` | Admin phone for seed (also accepts `SEED_ADMIN_PHONE`) |
| `ADMIN_PIN` | *(set locally)* | Six-digit admin PIN; the seed stores only its bcrypt hash |
| `SMS_PROVIDER` | `mock` | `mock` or `msg91` |
| `WHATSAPP_PROVIDER` | `mock` | `mock` or `meta` |
| `ADMIN_ALERT_PHONE` | *(optional)* | Phone for admin alerts |
| `TELEGRAM_BOT_TOKEN` | *(optional)* | Bot token from BotFather |
| `TELEGRAM_WEBHOOK_SECRET` | *(optional)* | Secret used to authenticate Telegram webhook updates |
| `TELEGRAM_BOT_USERNAME` | *(optional)* | Bot username, without the leading `@` |
| `PUBLIC_URL` | *(optional)* | Public HTTPS URL used by the webhook setup script |

## Telegram bot setup

1. Create a bot with [BotFather](https://t.me/BotFather). Copy its token and username into `TELEGRAM_BOT_TOKEN` and `TELEGRAM_BOT_USERNAME`; set `TELEGRAM_WEBHOOK_SECRET` to a long random value.
2. Run the backend on port `5000`. For local testing, start a tunnel:

   ```bash
   cloudflared tunnel --url http://localhost:5000
   ```

3. Use the HTTPS URL printed by cloudflared to register the webhook:

   ```bash
   npm run telegram:set-webhook -- https://<public-host>
   ```

4. Open a private chat with the bot and send `/myid`. To link an account, sign in to the library web app and use **Connect Telegram**.

In production, use a public HTTPS domain. Run only one backend server instance because scheduled jobs run in-process.

Webhook administration is also available through `npm run telegram:webhook-info` and `npm run telegram:delete-webhook`.

---

## 📡 API Reference

### Auth (`/api/auth`)

| Method | Path | Description |
|---|---|---|
| `GET` | `/seats/available` | List unassigned active seats for student registration |
| `POST` | `/register` | Register student with `{ name, phone, pin, seatNumber, shiftHours, whatsappOptIn?, smsOptIn? }` (status: pending) |
| `POST` | `/login` | Shared student/admin login with phone + 6-digit PIN |
| `POST` | `/logout` | Clear session cookie |
| `GET` | `/me` | Get current user info |

### Student (`/api/me`) — Requires student role

| Method | Path | Description |
|---|---|---|
| `GET` | `/status` | Get account status + active session |
| `GET` | `/seats/available` | List all free seats |
| `POST` | `/checkin` | Check in using the student's assigned seat and shift: `{ seat, shiftHours }` |
| `POST` | `/checkout` | Check out current session |
| `GET` | `/attendance?month=YYYY-MM` | Attendance history |
| `GET` | `/summary?month=YYYY-MM` | Monthly study summary |
| `GET` | `/fees` | List own fee records |
| `GET` | `/profile` | Get profile |
| `PATCH` | `/profile` | Update name, opt-ins |
| `POST` | `/change-pin` | Change PIN: `{ oldPin, newPin }` |
| `POST` | `/telegram/link` | Create a one-time Telegram linking URL |
| `GET` | `/telegram/status` | Get Telegram connection status |
| `DELETE` | `/telegram` | Unlink Telegram |

### Admin (`/api/admin`) — Requires admin role

| Method | Path | Description |
|---|---|---|
| `GET` | `/seats/live` | Live seat occupancy view |
| `GET` | `/students` | List students (filters: status, search) |
| `GET` | `/students/:id/available-seats` | List seats the student can keep or be assigned |
| `POST` | `/students` | Add approved student `{ name, phone, pin?, seatNumber, shiftHours, monthlyFee, whatsappOptIn, smsOptIn }`; returns the PIN once |
| `GET` | `/students/:id` | Get single student |
| `PATCH` | `/students/:id` | Edit student (name, phone, optional email, seat, shift, fee, opt-ins) |
| `PATCH` | `/students/:id/status` | Approve/reject/block student |
| `POST` | `/students/:id/reset-pin` | Generate and return a new six-digit student PIN once; unlocks the account |
| `GET` | `/students/:id/attendance` | Student attendance |
| `GET` | `/sessions` | All sessions (filters + pagination) |
| `POST` | `/sessions/:id/force-checkout` | Force check out student |
| `GET` | `/fees` | All fees (filters: status, month) |
| `PATCH` | `/fees/:id/pay` | Mark fee as paid |
| `POST` | `/fees/generate` | Manually run fee job: `{ month: "YYYY-MM" }` |
| `GET` | `/reports/summary?from=&to=` | Revenue, session totals, daily attendance, and hourly occupancy |
| `GET` | `/reports/students?month=` | Per-student study time |
| `GET` | `/export/attendance.csv` | Download CSV export |
| `GET` | `/notifications` | All notifications |
| `GET` | `/notifications/failed` | Failed notifications |
| `POST` | `/telegram/link` | Create a one-time Telegram linking URL |
| `GET` | `/telegram/status` | Get Telegram connection status |
| `DELETE` | `/telegram` | Unlink Telegram |
| `POST` | `/telegram/test` | Send a test Telegram message |
| `GET` | `/health` | Health check |

`/reports/summary` returns the requested period's session and fee totals, plus `daily` check-in/check-out counts for the latest 30 days and `hourly` average occupancy percentages for hours 06:00–23:00. Fee totals include both `unpaidFees` and `unpaidFeeAmount`.

---

## 🧪 cURL Examples

### Register a student
```bash
curl -X POST http://localhost:5000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"name":"Rahul Kumar","phone":"9876543210","pin":"123456","seatNumber":10,"shiftHours":4}'
```

### Login as student or admin
```bash
curl -X POST http://localhost:5000/api/auth/login \
  -H "Content-Type: application/json" \
  -c cookies.txt \
  -d '{"phone":"PHONE_NUMBER","pin":"SIX_DIGIT_PIN"}'
```

### Approve a student
```bash
curl -X PATCH http://localhost:5000/api/admin/students/STUDENT_ID/status \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{"status":"approved"}'
```

### Student check-in
```bash
curl -X POST http://localhost:5000/api/me/checkin \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{"seat":10,"shiftHours":4}'
```

### Student check-out
```bash
curl -X POST http://localhost:5000/api/me/checkout \
  -b cookies.txt
```

### Generate monthly fees manually
```bash
curl -X POST http://localhost:5000/api/admin/fees/generate \
  -H "Content-Type: application/json" \
  -b cookies.txt \
  -d '{"month":"2026-10"}'
```

### Export attendance CSV
```bash
curl -b cookies.txt \
  "http://localhost:5000/api/admin/export/attendance.csv?from=2026-10-01&to=2026-10-31" \
  -o attendance.csv
```

---

## 🔐 Security Defaults

- PIN is hashed with bcrypt (12 rounds). Never stored or logged in plain text.
- Login: 5 wrong attempts → account locked 15 minutes (same generic error message to prevent enumeration)
- JWT stored in `httpOnly`, `sameSite=lax` cookie (secure in production)
- Every authenticated request re-fetches user from DB (blocked users cut off immediately)
- All input validated with Zod
- Helmet + CORS limited to `CLIENT_URL`
- Stack traces never leaked in production

---

## ⚙️ Background Jobs

| Job | Schedule | Purpose |
|---|---|---|
| Shift Monitor | Every 1 min | Reminder (10 min before), shift-ended, overtime admin alert, auto-checkout (30 min past end) |
| Notification Worker | Every 30 sec | Process queued SMS/WhatsApp/in-app notifications (max 3 retries, WhatsApp→SMS fallback) |
| Monthly Fees | 1st of month (IST) | Generate unpaid fee records for all approved students |

---

## 📌 Defaults Used

- Seat count: 70
- Shift options: 4h, 12h, 24h
- Timezone: Asia/Kolkata (IST)
- JWT: Admin = 1 day, Student = 30 days
- Max failed login attempts: 5 → lock for 15 minutes
- Auto-checkout: 30 minutes after shift ends
- Overtime alert: 15 minutes after shift ends
- Notification retries: max 3
