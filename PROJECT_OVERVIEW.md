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
| Authentication | Shared phone/PIN login; JWT in an HTTP-only cookie |
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
│   └── notification-plan.md       # Notification design notes; not all planned features are implemented
├── MASTER_PLAN.md
├── PROJECT_OVERVIEW.md
└── PROJECT_WORKFLOWS.md
```

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
| Fees | `/admin/fees` | Review fees, mark payment, and generate fee records |
| Reports | `/admin/reports` | View reports and export attendance |
| Alerts | `/admin/alerts` | Review notifications, delivery status, and supported manual follow-ups |

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

The jobs run inside the backend process. Run one backend instance in
production, because starting multiple instances would also start multiple
copies of these jobs.

- **Shift monitor:** every minute; enqueues an eligible reminder shortly before
  a shift ends, a shift-ended notification, and an admin overtime alert after
  15 minutes.
- **Notification worker:** every 30 seconds; sends queued Telegram messages,
  marks in-app notifications delivered, and retries supported queued sends up
  to three times.
- **Monthly fees:** at 00:01 IST on the first day of each month; generates
  unpaid fee records for the previous month for approved students with a
  positive monthly fee.

An overtime session does **not** automatically end. The student or an
administrator must check it out. Admin force-checkout records the completed
session and frees the seat.

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

- The bot supports `/myid`, which replies with the sender's numeric Telegram
  ID, and `/start` with or without a link code.
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

**Implementation boundary:** the current bot code handles account linking,
`/myid`, and `/start`. The separate
[notification plan](./docs/notification-plan.md) describes additional
ideas—including owner approvals and commands such as `/live`, `/pending`,
`/unpaid`, `/requests`, and `/admins`—that are not present in the current bot
handlers. Treat those as planned, not as available bot features.

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
3. Students see only their own fee records; administrators can review report
   summaries and download attendance CSVs.

### Notifications

1. A business event (such as approval, a shift milestone, or fee generation)
   creates a notification record using a shared message template.
2. The selected delivery path determines whether a notification is queued for
   Telegram, recorded in-app, or made available for a supported manual
   WhatsApp/SMS follow-up.
3. The worker updates queued delivery status and retries Telegram failures.
   Administrators can review notification status in `/admin/alerts`.

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

- Serve the frontend build over HTTPS and proxy `/api` to the backend.
- Configure the production frontend origin, MongoDB URI, and a strong unique
  JWT secret in the backend environment.
- Set production cookie/proxy settings correctly and keep credentials out of
  source control.
- Configure Telegram's webhook only when a public HTTPS endpoint is available.
- Run one backend instance while scheduled jobs are process-local.
