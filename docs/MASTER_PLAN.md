# Library Study Tracker — Project Master Plan

This is the project’s implementation and release checklist, based on
`Library_Study_Tracker_Master_Plan.docx`. The checked-in application lives in
`backend/` and `frontend/`; task names below use those actual folder names.

**Execution rule:** verify a task against the current code before changing it.
Check an item only when its acceptance criteria pass. Existing code is not
considered complete merely because a file or screen already exists.

## 1. Product scope

Build a responsive application for a 70-seat study library in India:

- Students register with a phone number and six-digit PIN, then check in by
  choosing an available seat and a 4-, 12-, or 24-hour shift.
- Students can check in and out, and review attendance, study summaries, fees,
  and their profile.
- Administrators manage students, live seats, sessions, fees, reports, alerts,
  and their own profile.
- Dates and billing boundaries use Asia/Kolkata. Study duration is displayed
  as `Xh Ym`.

### Decisions locked for v1

- Seat and shift are chosen at check-in, not registration.
- Student registration includes name, phone, PIN, and notification opt-ins;
  it does not ask for email, seat, or shift.
- Student and admin authentication share one phone-and-six-digit-PIN login form.
- Set `ADMIN_PIN` in the backend environment and run the seed to provision the admin's PIN hash.
- Admin can create a student who is approved immediately. If no PIN is supplied,
  generate a random six-digit PIN and show it once.
- Admin settings include profile name and password change only. Library name,
  hours, and seat capacity belong in configuration.
- Student summaries show total time, days attended, average per day, and
  overtime; streaks and targets are out of scope.
- Student lists show current seat only when checked in. Do not add Plan or Shift
  columns.
- All server messages are English. Surface the server-provided error message.
- Monthly billing on the first creates fees for the previous month.
- No dark mode in v1.
- Run one backend server instance because scheduled jobs run in-process.
- Use `seat` as the check-in request field and the codebase’s existing field
  names; never expose PIN/password hashes.

## 2. Architecture and engineering rules

### Stack

- Backend: Node.js 20+, Express, TypeScript, MongoDB, and Mongoose.
- Frontend: Vite, React, TypeScript, Tailwind CSS v4, Redux Toolkit, and React
  Router.
- Authentication: JWT in an HTTP-only cookie; 30-day student and one-day admin
  session lifetime.
- Jobs: node-cron in the single backend process.
- Dates: Asia/Kolkata; frontend formatting must not rely on the browser’s local
  timezone.
- Deployment: Nginx serves the frontend and proxies `/api` to the backend over
  HTTPS.

### Rules for every change

- Keep API calls in the established shared data layer; do not add page-local
  `fetch` or Axios calls. Prefer the project’s existing data/API patterns.
- Every page that loads data must present loading, error, retry, and empty
  states as applicable.
- Keep shared types in `frontend/src/types/` and validate request input on the
  server.
- Derive student identity and role from the authenticated server-side session,
  never from a client-supplied user ID.
- Protect destructive actions with a confirmation dialog.
- Seat status must include text or a symbol as well as its color.
- Preserve keyboard access, visible focus, accessible labels, and responsive
  behavior.
- Do not log credentials, PINs, tokens, or one-time PIN values.

## 3. API contract to verify

All routes below are under `/api`. Confirm real status codes, permissions,
request validation, response shapes, and error handling before relying on an
endpoint in a screen.

### Authentication and student

| Method and path | Request | Expected result |
|---|---|---|
| `GET /auth/me` | Auth cookie | Current authenticated user |
| `POST /auth/login` | `{ phone, pin }` | Authenticated student or admin; role determines destination |
| `POST /auth/register` | `{ name, phone, pin, whatsappOptIn, smsOptIn }` | Registration confirmation |
| `POST /auth/logout` | Auth cookie | Logout confirmation and cookie cleared |
| `GET /me/status` | Student cookie | `{ checkedIn, session? }` |
| `GET /me/seats/available` | Student cookie | Available seat numbers |
| `POST /me/checkin` | `{ seat, shiftHours }` | Confirmation and session |
| `POST /me/checkout` | Student cookie | `{ studyTime, durationMinutes }` |
| `GET /me/attendance?month=YYYY-MM` | Student cookie | Month’s sessions with duration |
| `GET /me/summary?month=YYYY-MM` | Student cookie | `totalMinutes`, `totalFormatted`, `daysAttended`, `avgMinutes`, `overtimeMinutes` |
| `GET /me/fees` | Student cookie | Student’s fee records only |
| `GET /me/profile` | Student cookie | Student’s profile |
| `PATCH /me/profile` | Name and notification preferences | Updated profile; phone and fee cannot be changed here |
| `POST /me/change-pin` | `{ oldPin, newPin }` | PIN change confirmation |

### Administrator

| Method and path | Request / expected result |
|---|---|
| `GET /admin/students?status=&q=&page=&limit=` | Search and pagination; include current-month fee status and current seat when checked in |
| `POST /admin/students` | `{ name, phone, pin?, monthlyFee, whatsappOptIn, smsOptIn }` → approved student and one-time PIN |
| `GET /admin/students/:id` | Student details |
| `PATCH /admin/students/:id` | Update permitted profile and fee fields |
| `PATCH /admin/students/:id/status` | `{ status, monthlyFee? }` |
| `POST /admin/students/:id/reset-pin` | New PIN returned once; account lock cleared |
| `GET /admin/seats/live` | All active/inactive seats with occupant and shift details |
| `GET /admin/sessions` | Date, student, seat, and status filters with pagination |
| `POST /admin/sessions/:id/force-checkout` | Force checkout; seat is released and duration is recorded |
| `GET /admin/fees` | Month/status/search filters with pagination |
| `PATCH /admin/fees/:id/pay` | Mark a fee paid |
| `POST /admin/fees/generate` | `{ month: "YYYY-MM" }`; skip existing fee records |
| `GET /admin/reports/summary?from=&to=` | Summary cards, 30-day daily attendance series, hourly occupancy series |
| `GET /admin/reports/students?month=YYYY-MM` | Per-student study duration and session totals |
| `GET /admin/export/attendance.csv` | Attendance CSV download |
| `GET /admin/notifications` | Paginated notification log |
| `GET /admin/notifications/failed` | Paginated failed/admin alerts |
| `PATCH /admin/me` | Update admin profile name |
| `POST /admin/change-password` | `{ oldPassword, newPassword }` |

## 4. Backend delivery track

### B1 — Verify authentication and core flows

- [x] Verify registration, approval, shared student/admin PIN login, check-in, and check-out end to end.
- [x] Verify English server errors, correct seat field/type, unique active-seat
  and active-student session constraints, atomic checkout, generic login errors,
  and lockout after five incorrect PIN attempts for 15 minutes.
- [x] Verify role enforcement on every admin endpoint.

**Acceptance:** normal student flow succeeds; duplicate seat conflicts return
409; a student calling an admin endpoint receives 403.

### B2 — Complete student APIs

- [ ] Verify attendance, summary, fees, profile, and change-PIN endpoints.
- [ ] Validate input and ensure the user can only access their own records.
- [ ] Apply Asia/Kolkata month boundaries; return numeric duration and `Xh Ym`.

**Acceptance:** each API matches section 3, including empty months and month
boundaries.

### B3 — Complete admin student management

- [ ] Add server-side pagination and name/phone search (`q`); include
  `feeStatus` and `currentSeat`.
- [ ] Add student detail and permitted edit endpoints.
- [ ] Add approved-on-create student endpoint; generate a random six-digit PIN
  when omitted and reject duplicate phone numbers with 409.
- [ ] Reset PIN once per response and clear failed-attempt/lock fields.

**Acceptance:** search and pagination return correct records; newly added
students can log in immediately; PINs are never stored in plaintext, logged, or
sent in notifications.

### B4 — Live seats and session control

- [ ] Return the seat inventory with number, active state, status, and occupant
  session details.
- [ ] Add session filters and pagination.
- [ ] Make force-checkout safe against duplicate/concurrent checkout and record
  checkout type and duration.

**Acceptance:** all 70 configured seats are represented; force checkout frees
the seat and the session is no longer active.

### B5 — Background jobs

- [ ] Shift monitor runs every minute: reminder at 10 minutes before shift end,
  shift-ended alert, admin overtime alert at +15 minutes, and auto-checkout at
  +30 minutes.
- [ ] Auto-checkout study duration is capped at `shiftEndsAt`.
- [ ] Notification worker runs every 30 seconds.
- [ ] Monthly job runs on the first in Asia/Kolkata and creates fees for the
  previous month for approved students with a positive monthly fee.
- [ ] Ensure jobs are restart-safe and alerts/fees are idempotent.

**Acceptance:** each notification fires once; repeated fee generation creates
no duplicates.

### B6 — Fees

- [ ] Support month, status, search, and pagination on fee listing.
- [ ] Mark fees paid and generate fees for a requested month.
- [ ] Preserve database-level duplicate protection.

### B7 — Reports and export

- [ ] Return report summary cards and fee totals.
- [ ] Return daily check-in counts for the latest 30 days.
- [ ] Return average occupancy by hour from 06:00 through 23:00.
- [ ] Return per-student report and attendance CSV.

**Acceptance:** report values are calculated from persisted records; empty
periods return valid zero/empty series, not demo data.

### B8 — Alerts and admin account

- [ ] Add paginated notification and failed/admin-alert lists.
- [ ] Add admin name update and password change with current-password
  verification.

### B9 — Backend tests and providers

- [ ] Add automated tests for same-seat race, duplicate check-in, duplicate
  check-out, student access to admin API (403), blocked user with a valid token,
  PIN lockout, alert idempotency, auto-checkout duration cap, repeat fee job,
  and WhatsApp-to-SMS fallback.
- [ ] Verify configured SMS/WhatsApp providers and production credentials
  without exposing secrets.

**Acceptance:** all backend tests pass against an isolated test database; no
provider credentials are required for unit tests.

## 5. Frontend delivery track

### F1 — Foundation

- [ ] Verify environment configuration, routing, auth bootstrap, session-expiry
  behavior, store setup, API conventions, and `/api` development proxy.
- [ ] Keep the current folder conventions unless a migration is explicitly
  scheduled; do not duplicate API layers.

### F2 — UI kit and design tokens

- [ ] Verify shared icon, glass surfaces, ambient background, button, inputs,
  PIN input, badge, modal, confirmation, toast, skeleton, empty/error state,
  and pagination components.
- [ ] Ensure hover, focus, disabled, and loading states are consistent.

### F3 — Authentication pages

- [ ] Verify shared student/admin phone-and-PIN login and registration against
  the design references.
- [ ] Validate forms; show useful wrong-PIN, locked-account, pending/blocked,
  and network errors.
- [ ] Student login says “Forgot PIN? Ask the librarian.” Admin login has no
  forgot-password link.

### F4 — Student home and check-in

- [ ] Provide seat and shift selection, check-in, server-based countdown,
  overtime state, and confirmed checkout.
- [ ] Display checkout duration as `Xh Ym`.
- [ ] Refresh seat availability after conflict or successful check-in/out.

**Acceptance:** when two students choose the same seat, the second receives the
409 message and sees refreshed availability.

### F5 — Student records and profile

- [ ] Attendance month selector/calendar.
- [ ] Summary: total time, days attended, average per day, overtime.
- [ ] Fees, profile, notification preferences, and change PIN.
- [ ] Include loading, retry/error, and empty states.

### F6 — Admin layout

- [ ] Verify sidebar navigation, active state, responsive drawer/compact
  navigation, top bar, clock, alerts link, and profile/logout.

### F7 — Admin students

- [ ] Tabs/status filters, debounced search, responsive table/cards, and
  pagination.
- [ ] Add student form; approve with fee; reject, block, and reset PIN with
  confirmation.
- [ ] Show one-time PIN share card after create/reset; explain it is shown only
  once.

### F8 — Admin seats

- [ ] Live statistics, 10-column seat grid, details panel, and force checkout.
- [ ] Refresh every 15 seconds and pause polling when the tab is hidden.
- [ ] Pair every status color with readable text or a symbol.

### F9 — Admin sessions

- [ ] Filters, pagination, session details, and confirmed force checkout.

### F10 — Admin fees

- [ ] Month/status filters, mark-paid flow, and fee generation.
- [ ] Verify repeated generation is safe and explainable to administrators.

### F11 — Admin reports

- [ ] Summary cards, daily and hourly charts, per-student report, and CSV export.
- [ ] Use real backend report data and provide loading/error/empty states.

### F12 — Admin dashboard, alerts, settings

- [ ] Dashboard hero, live seat metrics/map, daily overview, shift distribution,
  recent attendance, and actionable links.
- [ ] Alerts list and read/failure states.
- [ ] Admin profile name and password settings.
- [ ] Respect the design blur budget: no more than 12 blurred dashboard
  surfaces; below 768px only designated keep-blur elements may blur.

### F13 — Polish and accessibility

- [ ] Keyboard-only review, accessible names, focus states, readable
  status labels, responsive layout, and error boundary/not-found handling.
- [ ] Review at 360px, 768px, and 1440px; target Lighthouse accessibility 90+.
- [ ] Test on real Android and iPhone devices.

## 6. Design and interaction requirements

- Use the provided `Stage 0 audit setup needed (1)` HTML files as visual
  references: `Student App.dc.html`, `Admin Login.dc.html`,
  `Admin Console.dc.html`, and `Interaction States.dc.html`.
- Fonts: IBM Plex Sans for body copy; Source Serif 4 for headings and key
  numbers; IBM Plex Mono for compact data where appropriate.
- Use the supplied brand assets under `frontend/public/brand/`.
- Prototype files may contain fake data: retain the intended layout and styles,
  but connect production screens to the actual API.
- Do not add demo-data badges, theme toggle, student registration email/seat
  fields, plan/shift columns, or streak/target UI.
- Respect reduced-motion and mobile performance preferences.

## 7. Milestones and build order

| Milestone | Backend | Frontend | Exit criteria |
|---|---|---|---|
| 1. Foundation and auth | B1, B2 | F1–F3 | Student registration and admin login work |
| 2. Student workflow | B2 | F4–F5 | Student can check in/out and review records on a phone |
| 3. Core administration | B3–B5 | F6–F8 | Admin can manage students and live seats |
| 4. Billing and reporting | B6–B8 | F9–F11 | Fees, reports, alerts, and exports use real data |
| 5. Release readiness | B9 | F12–F13 | Dashboard/settings complete; tests and accessibility checks pass |
| 6. Deployment | Operations | Operations | HTTPS production app and QR poster are live |

Start SMS DLT and WhatsApp template/provider approvals early; external approval
can take days or weeks.

## 8. End-to-end verification checklist

- [ ] Register, approve, then log in.
- [ ] Refresh preserves the valid session cookie; logout clears the session.
- [ ] Two browsers contend for one seat; second check-in receives a conflict and
  refreshes availability.
- [ ] Duplicate check-in/out show understandable errors.
- [ ] Blocked users lose access on their next protected request.
- [ ] Students cannot access admin pages or APIs.
- [ ] Overtime and auto-checkout occur at the correct thresholds; recorded
  duration is capped at shift end.
- [ ] Logging out and logging in as another user does not reveal previous-user
  data.
- [ ] Layout works at 360px, 768px, and 1440px; test a real Android and iPhone.
- [ ] Admin pages work with keyboard-only input.
- [ ] Admin-created student can sign in immediately.
- [ ] Duplicate phone is rejected with a friendly message.
- [ ] PIN reset unlocks the account, new PIN works, and old PIN fails.
- [ ] Dashboard, reports, and tables show persisted data, not placeholder values.

## 9. Deployment checklist

- [ ] Provision MongoDB Atlas, a least-privilege database user, backups, and
  restricted network access.
- [ ] Provision Ubuntu VPS and Node.js 20+.
- [ ] Configure production environment variables and rotate strong secrets.
- [ ] Build backend and frontend; run migrations/seed only as documented.
- [ ] Run one backend process under a process manager; do not scale cron jobs
  horizontally without moving them to a singleton/queue.
- [ ] Configure Nginx to serve the frontend, proxy `/api`, and return
  `index.html` for client-side routes.
- [ ] Enable HTTPS and secure production cookies.
- [ ] Complete SMS DLT entity/header/template registration and WhatsApp
  Business/template setup; verify opt-in and fallback behavior.
- [ ] Print a QR poster pointing to `https://<your-domain>/login`.
- [ ] Verify health checks, logs, restore procedure, and production smoke test.

## 10. Change and completion log

Use this section to record accepted deviations from the locked decisions,
release dates, and links to issues/PRs. Keep credentials and personal student
data out of this document.

| Date | Decision or release | Reference |
|---|---|---|
|  |  |  |
