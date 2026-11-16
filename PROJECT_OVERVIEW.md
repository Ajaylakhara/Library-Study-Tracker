# Library Study Tracker — Project Overview

The Library Study Tracker is a web application for operating a single study
library. Students use it to manage their study sessions and account records;
administrators use it to manage students, seats, fees, reports, and
notifications. The application stores its data in MongoDB and has an optional
Telegram bot integration.

This document describes the current `backend/` and `frontend/` implementation.
For step-by-step local setup and user workflows, see
[PROJECT_WORKFLOWS.md](./PROJECT_WORKFLOWS.md). For the implementation
checklist, see [MASTER_PLAN.md](./MASTER_PLAN.md).

## Live application

- **Frontend:** [https://library-study-tracker.vercel.app](https://library-study-tracker.vercel.app)
- **Backend:** [https://library-study-tracker-z69g.vercel.app/](https://library-study-tracker-z69g.vercel.app/)

## At a glance

| Area | Current implementation |
|---|---|
| Frontend | React, TypeScript, Vite, Redux Toolkit, React Router, Tailwind CSS v4 |
| Backend | Node.js, TypeScript, Express, Mongoose |
| Database | MongoDB |
| Authentication | Shared phone/PIN login; 30-day JWT in an HTTP-only cookie that renews while the app is in use; lockout after repeated wrong PINs |
| Library capacity | 70 numbered seats |
| Time zone | Asia/Kolkata (IST) for scheduled billing and date boundaries |
| Notifications | In-app, Telegram, and admin-assisted WhatsApp/SMS for supported notification types |
| Telegram | Optional webhook integration for linking student/admin accounts and sending bot messages |

## Repository layout

```text
LMS(Library Management System)/
├── backend/
│   ├── src/
│   │   ├── app.ts                 # Express middleware and API route mounting
│   │   ├── server.ts              # MongoDB connection, jobs, and HTTP listener
│   │   ├── config.ts              # Environment configuration
│   │   ├── controllers/           # HTTP request handlers
│   │   ├── jobs/                  # Shift, notification, and monthly-fee jobs
│   │   ├── middleware/            # Authentication, role checks, error handling
│   │   ├── models/                # User, Seat, Session, Fee, Notification
│   │   ├── routes/                # Auth, student, admin, and Telegram routes
│   │   ├── services/notifications/ # Message creation, templates, providers, bot updates
│   │   └── utils/                 # Time, CSV, seat assignments, async helpers
│   └── tests/                     # Backend business-rule and Telegram tests
├── frontend/
│   └── src/
│       ├── components/            # Shared UI and interaction components
│       ├── config/                # API endpoint and app configuration
│       ├── hooks/                 # Polling, timers, form and responsive hooks
│       ├── layout/                # Student and admin navigation/layouts
│       ├── pages/                 # Auth, student, and admin screens
│       ├── routes/                # Role-protected application routes
│       ├── store/                 # Redux store and shared API utilities
│       ├── toolkit/               # Redux slices and async thunks
│       └── types/                  # Shared frontend data types
├── docs/
│   ├── DEPLOY_CHECKLIST.md        # Manual steps for production deploys (env vars, cron, webhook)
│   └── notification-plan.md       # Notification design notes; not all planned features are implemented
├── MASTER_PLAN.md
├── PROJECT_OVERVIEW.md
└── PROJECT_WORKFLOWS.md
```

## How the frontend reaches the backend (proxy / rewrite)

The frontend and backend are separate Vercel projects on different domains, but
the browser only ever talks to the **frontend's own origin**:

- `frontend/vercel.json` rewrites `/api/:path*` to the backend deployment and
  serves `index.html` for every other path (single-page app routing).
- Production builds always call the relative path `/api` (the value of
  `VITE_API_URL` is ignored in production). Because the request is same-origin
  from the browser's point of view, the login cookie is first-party and is not
  blocked as a third-party cookie.
- In local development the Vite dev server proxies `/api` to
  `http://localhost:5000`, so nothing else needs configuring.
- If the backend URL changes, edit the rewrite `destination` in
  `frontend/vercel.json` and redeploy the frontend.

## Sign-in, sessions and lockout

- **Cookie:** `token`, httpOnly, `secure` in production, `sameSite=lax`, path
  `/`, lifetime 30 days. The token itself is a 30-day JWT for both students and
  admins.
- **Sliding session:** on any authenticated request, a token with fewer than 15
  days left is replaced by a fresh 30-day token. The account, role and status
  are re-checked on every request, so a blocked, rejected or deleted account
  loses access immediately even though its token has not expired.
- **`JWT_SECRET` is required.** There is no fallback value. In production the
  server refuses to start if it is missing, shorter than 32 characters, or a
  published placeholder.
- **Lockout:** 5 wrong PINs for a phone number lock sign-in for that number for
  15 minutes, and 30 failures from one address lock that address. Unknown phone
  numbers are counted too, and every lockout returns the same message, so
  responses never reveal whether a phone number exists. Admins use the same form
  and are covered by the same rules. Counters are stored in MongoDB
  (`LoginThrottle`), so they work across serverless instances.
- **Frontend:** the user is logged out only when the server answers 401 (or 403
  for a blocked account). A network error, timeout (for example a cold start)
  or 5xx on the account check is retried once and then shows a "Try again"
  screen; the session is kept.
- **Admin inactivity timeout:** after 30 minutes without activity the admin sees
  a 60-second warning and is then signed out. Controlled by
  `ADMIN_INACTIVITY_TIMEOUT_MINUTES` in `frontend/src/config/constants.ts`
  (`0` turns it off).

## User-facing application

### Public and authentication screens

| Screen | Route | Purpose |
|---|---|---|
| Login | `/login` | One phone-number and six-digit PIN form for students and admins |
| Registration | `/register` | Student account request with contact preferences and seat/shift assignment |
| Not found | `*` | Handles unknown routes |

Successful login routes each account to the area allowed by its role. Pending,
rejected, blocked, or otherwise invalid accounts are handled by the API and
frontend authentication flow.

### Student screens

| Screen | Route | Purpose |
|---|---|---|
| Home | `/home` | Check-in status, assigned seat/shift, countdown, and checkout |
| Attendance | `/attendance` | Review recorded study sessions |
| Summary | `/summary` | Review study-time and attendance totals |
| Fees | `/fees` | Review the student's own fee records |
| Profile | `/profile` | Review/update allowed profile settings and change PIN |

Students normally check in using their saved seat and shift. Older accounts
without an assignment may use the legacy seat/shift selection flow until an
administrator updates the account. A completed checkout records the session and
frees the seat; the student's seat assignment remains saved for a later visit.

### Administrator screens

| Screen | Route | Purpose |
|---|---|---|
| Dashboard | `/admin` | Operational overview |
| Live seats | `/admin/seats` | Current seat occupancy and active sessions |
| Students | `/admin/students` | Search, approve, edit, block, and manage student accounts |
| Sessions | `/admin/sessions` | Review sessions and force-checkout active sessions |
| Fees | `/admin/fees` | Review fees, mark payment, generate fee records, and prepare individual WhatsApp/SMS/Telegram reminders |
| Reports | `/admin/reports` | View reports and export attendance |
| Alerts | `/admin/alerts` | Review notifications, delivery status, and supported manual follow-ups; see "Alerts dashboard" below |

Administrators can create approved students, assign seats and shifts, and
provide a generated or supplied PIN to the student. A PIN returned during
creation or reset is intended to be shared securely and is not shown again by
the application.

## Backend architecture

The Express application is assembled in `backend/src/app.ts`. The server entry
point connects to MongoDB, synchronizes model indexes, starts scheduled jobs,
and then listens for HTTP requests.

### API groups

All application APIs are mounted below `/api`.

| API group | Prefix | Main responsibilities |
|---|---|---|
| Authentication | `/api/auth` | Register, login/logout, current account, registration seat list |
| Student | `/api/me` | Status, check-in/out, attendance, summary, fees, profile, PIN, Telegram link |
| Administrator | `/api/admin` | Students, live seats, sessions, fees, reports, CSV, notifications, Telegram link |
| Telegram webhook | `/api/telegram` | Receive and process Telegram bot updates |

The API uses JSON responses with a success/data or success/message shape.
Protected student and administrator routes authenticate the cookie and enforce
the corresponding role. Request handling uses shared async/error middleware.

### MongoDB records

| Model | What it stores |
|---|---|
| `User` | Admin/student account, account status, assigned seat/shift, PIN hash, preferences, and optional Telegram linkage |
| `Seat` | Numbered seat and whether it is active |
| `Session` | Student, seat, shift, check-in/out timestamps, duration, and notification flags |
| `Fee` | Student's monthly charge, billing month, and payment status |
| `Notification` | Notification type, recipient/channel, message, delivery state, and related session/fee |

PINs and passwords are stored as hashes and are excluded from normal user
responses. Student records can be soft-deleted while preserving historical
attendance and fee records. MongoDB indexes enforce important uniqueness rules,
including seat/session conflicts and duplicate fee protection.

### Background jobs

On an always-on server, the jobs can run inside the backend process. On Vercel,
in-process scheduling is disabled; configure a minute-level external scheduler
to call the authenticated cron endpoint described under Deployment notes.

- **Shift monitor:** catches up on missed runs; enqueues a reminder only while
  the shift is ending soon (last 10 minutes), a shift-ended notification after
  end, and an admin overtime alert after 15 minutes. Overtime alerts can be
  snoozed for 15 minutes and optionally repeated (up to six times). It creates
  the notification records **first** and marks the session's "alert sent" flag
  only afterwards, so a database failure leaves the alert to be retried on the
  next tick instead of silently losing it. The unique notification index makes
  repeating that step harmless. The rules live in `utils/shiftTiming.ts`.
- **Notification worker:** sends queued Telegram messages, marks in-app
  notifications delivered, and records `attempts`, `lastAttemptAt`,
  `nextAttemptAt` and `lastError` on every notification. See "Delivery retries".
- **Time zone:** session times are stored as UTC instants and compared as
  instants. Anything shown to people (for example "shift ends at 11:00 AM") must
  go through `formatIST()` in `utils/time.ts`; `date-fns-tz`'s `format()` alone
  prints the server's time zone, which is UTC on Vercel.
- **Monthly fees:** at 00:01 IST on the first day of each month; generates
  unpaid fee records for the previous month for approved students with a
  positive monthly fee.

An overtime session does **not** automatically end. The student or an
administrator must check it out. Admin force-checkout records the completed
session and frees the seat.

### Delivery retries

- A Telegram notification gets 3 quick attempts. After that it is shown as
  `failed`, but it is **still retried automatically for 24 hours** with growing
  waits (1, 2, 5, 10, 15, 30, then 60 minutes) up to 8 attempts in total. A
  Telegram "retry after" answer is respected without blocking the cron run.
- A "bot blocked by user" (403) answer is permanent: no automatic retry
  (`permanentFailure`).
- A failed shift-reminder, shift-ended or overtime message is **not** retried
  once its study session has ended.
- On `/admin/alerts`, **Retry failed** puts every failed Telegram notification
  from the last 24 hours back in the queue (admin only,
  `POST /api/admin/notifications/retry-failed`). The next cron tick delivers
  them.
- If no admin has Telegram linked when an overtime alert is created, the in-app
  alert carries the warning "Telegram alert NOT sent: no admin has Telegram
  linked", and a warning is logged, instead of failing silently.
- Errors are logged as one-line JSON (`type`, `sessionId`, `notificationId`,
  the Telegram error text). The bot token is redacted from all log output.

### Alerts dashboard (`/admin/alerts`)

| Field | Meaning |
|---|---|
| Banner | Last background check time; turns red with a warning if there was **no cron run in the last 3 minutes**, or the last run failed, or `CRON_SECRET` is missing |
| Last cron run | Time of the last `/api/cron/tick`, with its result: notifications queued, sent, failed, and how long it took |
| Failed notifications | Count of notifications in the `failed` state, and how many are still retryable (last 24 hours) |
| Admin Telegram | Whether any active admin has Telegram linked; "Not linked" means overtime alerts cannot reach Telegram |
| Retry failed | Re-queues the retryable failed Telegram notifications |

The numbers come from `GET /api/admin/jobs/status`. The last tick is stored in
MongoDB (`JobRun` record named `tick`: `completedAt`, `error`, `result`).

## Telegram bot workflow

Telegram is optional. The backend needs a bot token, username, webhook secret,
and a publicly reachable HTTPS backend URL before Telegram linking and
delivery can work.

### 1. Configure and expose the bot

1. Create a Telegram bot with BotFather and keep the bot token private.
2. Set `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, and
   `TELEGRAM_WEBHOOK_SECRET` in the backend environment. Set `PUBLIC_URL` to
   the public HTTPS address when using the webhook setup script.
3. Run the backend and register its webhook with
   `npm run telegram:set-webhook -- https://<public-host>` from `backend/`.
4. Confirm Telegram can reach the webhook over HTTPS. For local development,
   use a temporary HTTPS tunnel and configure the webhook to its public URL.

The webhook is `POST /api/telegram/webhook`. The backend checks Telegram's
`X-Telegram-Bot-Api-Secret-Token` header, responds to the update, then processes
the update. Do not expose the bot token or webhook secret in frontend code or
documentation.

### 2. Link a user's Telegram account

1. An authenticated student or administrator requests a Telegram link from the
   app. The backend creates a random, single-use link code that expires after
   10 minutes and returns a `t.me` deep link.
2. The user opens the link in a **private chat** with the bot. Telegram sends
   `/start <code>` to the webhook.
3. The backend hashes the submitted code, checks that it is valid and
   unexpired, and links the private chat to the matching account.
4. The bot confirms the link. A Telegram chat can only be linked to one
   account for a given role; a used or expired code cannot be reused.
5. The user can check link status or disconnect through the authenticated
   account's API routes.

### 3. Bot messages and notification delivery

- The bot supports `/start` for account linking and `/myid`, `/menu`, `/live`,
  `/pending`, `/overtime`, `/unpaid`, `/fees`, and `/help` for linked,
  active administrators.
- `/live` shows checked-in and overtime counts, available seats, and time
  remaining, with a Refresh button. `/unpaid` shows current/previous month
  unpaid fees and a reminder action. `/fees` searches students by name or
  phone; the search state is stored in MongoDB and expires after five minutes.
- Fee reminders use the same backend service from the bot and `/admin/fees`.
  WhatsApp and SMS reminders are prepared for manual sending; linked students
  can also receive a reminder directly through Telegram.
- The `/overtime` Remind student action now offers WhatsApp, SMS, and linked
  Telegram. WhatsApp opens a prefilled `wa.me` chat; SMS opens the authenticated
  reminder page so the administrator can open the SMS app, then mark it sent.
- Eligible notification events are stored in MongoDB before delivery. The
  worker sends queued Telegram messages and records success or failure.
- A linked student can receive the approval notification; shift and fee
  notification delivery through Telegram depends on the student's selected
  preferred channel and the event type.
- Linked administrators can receive queued Telegram admin notifications.
- For supported fee/overtime student notifications where the selected channel
  is WhatsApp or SMS, the Alerts workflow can provide a prefilled WhatsApp or
  SMS link for an administrator to send manually, then record it as sent.
- Unlinked users do not become automatically linked just by messaging the bot;
  they need to start from a valid app-generated link.

**Implementation boundary:** `/requests` and `/admins` remain ideas in the
separate [notification plan](./docs/notification-plan.md); they are not current
bot commands.

## Main end-to-end workflows

### Student registration and approval

1. A student opens `/register`, enters their details and PIN, and selects an
   available seat/shift and notification preference.
2. The API validates the request, checks seat and phone conflicts, and creates
   a pending student account.
3. An administrator reviews the request in `/admin/students` and approves or
   rejects it. Approval can set the monthly fee.
4. The approved student signs in through the shared `/login` screen.

### Study session

1. The student signs in and opens `/home`.
2. The app submits a check-in request using the student's assigned seat and
   shift (or the legacy selection, if the account has no assignment).
3. The backend verifies the account and seat, creates an active session, and
   returns the session state and shift end time.
4. The frontend displays the session timer. The student checks out from Home,
   or an administrator performs a force-checkout when necessary.
5. The backend records the completed duration and makes the seat available
   again. Attendance and summary screens read the persisted session history.

### Fees and reporting

1. The monthly job or an administrator's manual action creates fee records.
   Existing student/month records are skipped.
2. An administrator reviews fees and marks payments in `/admin/fees`.
   The Remind action prepares a student-specific message and lets the admin
   choose WhatsApp, SMS, or Telegram when linked. Manual sends can be marked
   sent, and reminders sent within the previous 24 hours require confirmation.
3. Students see only their own fee records; administrators can review report
   summaries and download attendance CSVs.

### Notifications

1. A business event (such as approval, a shift milestone, or fee generation)
   creates a notification record using a shared message template.
2. The selected delivery path determines whether a notification is queued for
   Telegram, recorded in-app, or made available for a supported manual
   WhatsApp/SMS follow-up.
3. The worker updates queued delivery status and retries Telegram failures
   (see "Delivery retries"). Administrators can review notification status in
   `/admin/alerts`.

## Local development

### Prerequisites

- Node.js 20 or newer is recommended.
- A MongoDB local instance or Atlas database.
- A private backend environment file with the database URI, JWT secret, and
  seed administrator settings. Follow the detailed setup in
  [PROJECT_WORKFLOWS.md](./PROJECT_WORKFLOWS.md); never commit real secrets.

### Start the backend

From `backend/`, install dependencies and initialize the database as needed:

```powershell
npm install
npm run seed
npm run dev
```

The API defaults to `http://localhost:5000`; its health endpoint is
`http://localhost:5000/health`.

### Start the frontend

In a second terminal, from `frontend/`:

```powershell
npm install
npm run dev
```

Vite normally serves the app at `http://localhost:5173` and proxies `/api` to
the backend at port 5000. The proxy allows the frontend to use the
HTTP-only authentication cookie on the same origin during development.

## Build and tests

Run commands from the corresponding package folder:

```powershell
# backend
npm run build
npm test

# frontend
npm run typecheck
npm run build
```

Backend tests may require a separately configured test database. Never point
tests at the only copy of production data.

## Deployment notes

The step-by-step production checklist (including the manual steps) is in
[docs/DEPLOY_CHECKLIST.md](./docs/DEPLOY_CHECKLIST.md). Every environment
variable is listed with placeholders in `backend/.env.example` and
`frontend/.env.example`.

- Serve the frontend build over HTTPS. `frontend/vercel.json` proxies `/api` to
  the backend (see "How the frontend reaches the backend").
- Configure the MongoDB URI and a strong unique `JWT_SECRET` (32+ characters)
  in the backend environment. The backend will not start in production without
  it. Keep credentials out of source control.
- Configure Telegram's webhook only when a public HTTPS endpoint is available.
- For serverless scheduling, set a strong random `CRON_SECRET` in the backend
  environment. Call `POST https://<backend-host>/api/cron/tick` once per minute
  with the header `Authorization: Bearer <CRON_SECRET>` (or `x-cron-secret`).
  The combined endpoint runs shift monitoring, then the notification worker for
  up to three passes, inside a 25-second budget, and returns a JSON summary:
  `monitorRan`, `notificationsQueued`, `sent`, `failed`, `durationMs`,
  `timedOut`. Separate `GET` and `POST` endpoints are also available at
  `/api/cron/shift-monitor` and `/api/cron/notification-worker`.
- `backend/vercel.json` sets `maxDuration` to 60 seconds for the API function.
- Use cron-job.org, Vercel Pro Cron, or another scheduler for the minute-level
  call. Vercel Hobby cron is once per day, which is not enough.
- Set `RUN_JOBS_IN_PROCESS=false` on serverless deployments. On an always-on
  server, set it to `true` (the default) and run only one backend instance.
- `OVERTIME_REPEAT_MINUTES=0` disables automatic repeat alerts; positive
  values set the repeat interval, with a maximum of six repeats per session.
- The Alerts page reports “waiting for the first cron run” until the scheduler
  successfully calls `/api/cron/tick`; it reports missing `CRON_SECRET` when the
  serverless environment is not configured.
