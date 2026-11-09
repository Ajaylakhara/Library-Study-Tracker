# Library Study Tracker — End-to-End Project Workflows

This guide explains how to install, run, and use the current Library Study
Tracker from initial setup through student attendance, administration, billing,
and reporting. It documents the current code in `backend/` and `frontend/`.

> **Current seat/shift behavior:** New registrations and admin-created students
> are assigned a seat and a 4-, 12-, or 24-hour shift during creation. Their
> seat is reserved for them, and Home check-in uses that saved assignment. This
> supersedes the older seat-at-check-in decision in `MASTER_PLAN.md`. Older
> student accounts without an assignment retain the legacy seat/shift picker
> on Home until an admin assigns their seat and shift.

## 1. What the application does

- Supports one library with up to 70 numbered seats.
- Provides student registration, approval, login, assigned seat and shift,
  check-in/out, attendance, study summaries, fees, and profile actions.
- Provides an admin console for student management, live seats, sessions,
  fees, reports, and notifications.
- Uses one phone-number and six-digit PIN login for both students and admins.
- Stores application records in MongoDB and uses an HTTP-only cookie for login.
- Uses Asia/Kolkata (IST) for billing schedules and date reporting.

## 2. Project structure

```text
LMS(Library Management System)/
|-- backend/                 Express API, MongoDB models, jobs, tests
|-- frontend/                React/Vite web application
|-- library-brand-assets/    Brand and design resources
|-- MASTER_PLAN.md           Implementation checklist and original plan
`-- PROJECT_WORKFLOWS.md     This current end-to-end guide
```

### Main screens

| Role | Screen | URL |
|---|---|---|
| Public | Sign in | `/login` |
| Public | Register student | `/register` |
| Student | Home/check-in | `/home` |
| Student | Attendance | `/attendance` |
| Student | Study summary | `/summary` |
| Student | Fees | `/fees` |
| Student | Profile and PIN | `/profile` |
| Admin | Dashboard | `/admin` |
| Admin | Live seat monitor | `/admin/seats` |
| Admin | Students | `/admin/students` |
| Admin | Sessions | `/admin/sessions` |
| Admin | Fees | `/admin/fees` |
| Admin | Reports | `/admin/reports` |
| Admin | Alerts | `/admin/alerts` |

The UI redirects users to the section allowed by their authenticated role.
`/admin/login` redirects to the shared `/login` page.

## 3. Local setup and first run

### Requirements

- Node.js (20+ recommended)
- MongoDB local instance or MongoDB Atlas database
- PowerShell on Windows, or a terminal that supports the commands below

### Configure the backend

1. Open a terminal in `backend/`.
2. Create the local environment file:

   ```powershell
   Copy-Item .env.example .env
   ```

3. Edit `backend/.env` and set at least:
   - `MONGODB_URI` to the database connection string.
   - `JWT_SECRET` to a unique, long random value.
   - `ADMIN_PHONE` to the admin's 10-digit phone number.
   - `ADMIN_PIN` to a six-digit PIN for the initial admin account.
   - `CLIENT_URL` to `http://localhost:5173` for local development.

   Do not put real credentials in this guide, source control, screenshots, or
   chat. Keep `.env` private.

4. Install dependencies and initialize the database:

   ```powershell
   npm install
   npm run seed
   ```

   The seed command creates the 70 seats and provisions the admin using the
   `ADMIN_NAME`, `ADMIN_PHONE`, and `ADMIN_PIN` values. It also creates a
   development sample student if that phone is not already present. Run seed
   deliberately: running it again updates the seeded admin account and PIN.

### Start the API and web app

Use two terminals; leave both running while using the application.

**Terminal 1 — API**

```powershell
Set-Location backend
npm run dev
```

The API listens at `http://localhost:5000`. Check `http://localhost:5000/health`
for a health response.

**Terminal 2 — frontend**

```powershell
Set-Location frontend
npm install
npm run dev
```

Open the Vite URL shown in the terminal (normally `http://localhost:5173`).
Vite proxies `/api` to the API at port 5000. Sign in at `/login`.

### Build and test

Run from the corresponding package folder:

```powershell
# backend
npm run build
npm test

# frontend
npm run build
npm run typecheck
```

Backend integration tests in `backend/tests/businessRules.test.ts` connect to
MongoDB. Configure a test database before running tests; do not point tests at
the only copy of production data.

## 4. Roles and account lifecycle

### Student self-registration

1. Student opens `/register`.
2. The form loads seats that are active and not assigned to another
   non-deleted student.
3. Student enters their name, 10-digit phone, six-digit PIN, assigned seat,
   study shift, and optional WhatsApp/SMS preferences.
4. The API validates the information and checks phone and seat uniqueness.
5. The account is saved with `role=student` and `status=pending`.
6. The seat assignment is reserved while the account waits for approval.
7. The student sees a request confirmation and cannot log in until approved.
8. An admin reviews the student in `/admin/students` and approves or rejects
   the account. Approval can set the monthly fee.
9. After approval, the student signs in at `/login` using the same phone and PIN
   entered during registration.

If the registration request fails because the seat was just assigned to
someone else, refresh/retry and choose another available seat. A pending
student's seat remains assigned until that record is changed or removed.

### Admin-created student

1. Admin signs in and opens `/admin/students`.
2. Select **Add student**.
3. Enter name, phone, optional PIN, assigned seat, shift, monthly fee, and
   WhatsApp/SMS preferences.
4. The API verifies phone and seat availability and saves the student as
   `approved`.
5. If no PIN was supplied, the API generates a random six-digit PIN.
6. The one-time PIN dialog displays the PIN so the admin can securely share it.
   The PIN is not included in the student list; copy or record it before closing
   the dialog.
7. The student can sign in immediately using the phone and PIN.

### Admin student management

On `/admin/students`, the admin can:

- Search students by name or phone and view Pending, Approved, Rejected, and
  Blocked groups.
- Approve a pending or rejected student and set the monthly fee.
- Reject, block, or unblock a student.
- Edit name, phone, optional email, assigned seat, shift, monthly fee, and
  notification preferences.
- Reset a PIN. A newly generated PIN is shown once; reset also clears login
  lockout state.
- Soft-delete a student. Attendance and fee history are retained. An active
  student session must be checked out before deletion.

Seat changes are checked against other students' assignments and active
sessions. Changing an assignment does not rewrite an already active session;
the new assignment applies to the student's next check-in. Email is optional
and can be cleared in the Edit student dialog.

### Student data changes

Students can view their profile, assigned seat/shift, fee, status, and
notification preferences at `/profile`. They can update the profile fields
allowed by the application and change their PIN using their current PIN.
Seat, shift, phone, and monthly-fee changes are handled by the admin workflow.

## 5. Student check-in, checkout, and records

### Check-in

1. Approved student signs in and opens `/home`.
2. For accounts with a saved assignment, Home displays the assigned seat and
   shift; there is no need to select another one.
3. Student selects **Check In**.
4. The API checks approval, validates the saved seat and shift, confirms the
   seat is active and not occupied, and creates an active session.
5. Home displays the session timer/countdown and session state.
6. If a seat is unavailable or the student is already checked in, the API
   returns a conflict and the UI refreshes relevant status/seat data.

Legacy students with no saved assignment see the existing seat and shift
picker. An admin should edit these older records to assign a seat and shift.

### Checkout

1. Student selects **Check Out** from an active Home session and confirms the
   action.
2. The API completes the session and records checkout time and duration. The
   seat becomes unoccupied, but remains assigned to that student.
3. Home shows the completed study duration.
4. If an overtime alert exists for the session, its admin follow-up state is
   resolved automatically.

Admins can force-checkout an active session from the seat/session screens.
The session record identifies whether checkout was manual or forced. The
current shift monitor sends shift/overtime notifications but does not
automatically check students out; an overtime session remains active until a
student or admin checks it out. Active sessions are not changed by editing the
student's future seat/shift assignment.

### Student records

- **Attendance:** session dates, seat/shift, check-in/out, and duration.
- **Summary:** total sessions and study time, with daily/monthly summary
  values for the selected month.
- **Fees:** only that student's fee records.
- **Profile:** account details, seat/shift, notification preferences, and PIN
  change.

## 6. Admin operating workflows

### Dashboard and seats

- `/admin` shows current operational summary and activity.
- `/admin/seats` shows live active seats and session occupants.
- Seat state refreshes periodically. Use the live view to find an occupied
  seat or an active session before changing assignments or removing a student.
- Admin can force-checkout an active session when required.

### Sessions

`/admin/sessions` lists recorded sessions and provides filtering/pagination.
Review session state and duration here. A force checkout completes the active
session and frees the seat; it does not delete attendance history.

### Fees

- `/admin/fees` lists fee records; an admin can mark an unpaid fee as paid.
- At 00:01 IST on the first day of the month, the backend generates fee records
  for the previous month for approved students whose monthly fee is greater
  than zero.
- The admin can trigger fee generation for a `YYYY-MM` month manually.
- The unique student/month database constraint prevents duplicate fee records;
  repeated generation skips records that already exist.
- Students see their own records at `/fees`.

### Reports and alerts

- `/admin/reports` presents persisted session, fee, attendance, and student
  report data; attendance can be exported as CSV.
- `/admin/alerts` shows the notification log and notification status.
- Background jobs enqueue shift reminders, shift-ended notifications, and
  fee-related notifications. Admin overtime alert generation is temporarily
  disabled while its delivery method is undecided.
- The Alerts page shows failed and all-notification views. The **Needs action**
  overtime follow-up view and its admin endpoints are temporarily disabled.
- Student checkout and admin force-checkout still resolve any existing open or
  contacted overtime alerts.
- Notification delivery depends on backend provider configuration. Development
  defaults to mock providers; live MSG91 or Meta WhatsApp delivery requires
  valid provider credentials, templates/approvals, and student opt-in.

## 7. Data stored by the application

MongoDB is the source of truth. Main collections:

| Collection/model | Stored information | Lifecycle |
|---|---|---|
| `User` | Student/admin identity, phone, optional email, PIN hash, role/status, assigned seat/shift, fee amount, preferences, login lockout, deletion markers | Student records can be soft-deleted; hashes are excluded from normal API responses |
| `Seat` | Seat number 1–70 and active/inactive flag | Seeded seats are created once; active flag controls availability |
| `Session` | Student and seat references, shift, check-in/end/check-out times, duration, active/completed status, checkout type, alert flags | Created on check-in; completed on checkout; history is retained |
| `Fee` | Student, billing month, amount, unpaid/paid status, paid date, note, admin who marked paid | One record per student per month |
| `Notification` | Recipient, type/channel, queue/delivery status, attempts, error/provider details, read state, overtime action status/contact metadata, related session/fee | Queued and processed by notification worker; admin can review failures and notification history |

Existing overtime notifications retain an `actionStatus` of `open`,
`contacted`, or `resolved`, independently of delivery status and `read`.
Checkout sets `resolvedAt` for open or contacted alerts. New overtime alerts
and the associated needs-action/contact endpoints are temporarily disabled.

### Student statuses

- `pending`: awaiting admin decision; cannot log in.
- `approved`: can log in and use student features.
- `rejected`: cannot log in.
- `blocked`: admin has suspended access.
- Soft-deleted: hidden from normal student lists and cannot sign in; historic
  session and fee records are retained.

### Important data rules

- Phone numbers are 10 digits; PINs are six digits.
- PINs are bcrypt hashes at rest. A supplied or generated PIN is only returned
  in the create/reset response and shown in the UI one time.
- The application does not return PIN hashes or authentication tokens in
  normal student/admin data.
- One active session per student and one active session per seat are enforced.
- New student assignments reserve seats so one seat cannot be allocated to
  multiple non-deleted students.
- Dates are stored as dates and interpreted using IST for relevant monthly
  reports/billing.

## 8. Authentication and permissions

- Student and admin use the same `/login` form with `{ phone, pin }`.
- The server sets an HTTP-only JWT cookie after successful authentication.
- Admin accounts have a shorter token lifetime than student accounts.
- Student-only endpoints require an authenticated student. Admin endpoints
  require an authenticated admin.
- A student calling an admin endpoint receives a forbidden response.
- Five failed PIN attempts cause a temporary 15-minute account lock.
- Blocking/rejecting a student prevents further access on protected requests.
- Logout clears the cookie. On login expiry, sign in again.

Do not share a real PIN, token, MongoDB URI, JWT secret, provider key, or
student personal data in documentation, logs, screenshots, or source control.

## 9. API map

All routes are prefixed with `/api`.

### Public/authentication

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/auth/seats/available` | Unassigned seats for registration |
| `POST` | `/auth/register` | Create pending student with seat and shift |
| `POST` | `/auth/login` | Shared student/admin phone + PIN login |
| `POST` | `/auth/logout` | Clear session cookie |
| `GET` | `/auth/me` | Current authenticated account |
| `GET` | `/health` | API health |

### Student (student authentication required)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/me/status` | Account and active session |
| `GET` | `/me/seats/available` | Legacy seat-picker availability |
| `POST` | `/me/checkin` | Start session using assigned seat/shift |
| `POST` | `/me/checkout` | Finish active session |
| `GET` | `/me/attendance` | Attendance/session history |
| `GET` | `/me/summary` | Monthly study summary |
| `GET` | `/me/fees` | Own fee history |
| `GET` | `/me/profile` | Own profile and assignment |
| `PATCH` | `/me/profile` | Allowed profile/preferences update |
| `POST` | `/me/change-pin` | Change own PIN |

### Admin (admin authentication required)

| Method | Path | Purpose |
|---|---|---|
| `GET` | `/admin/seats/live` | Live seat/session data |
| `GET` | `/admin/students` | Search, filter, and paginate students |
| `POST` | `/admin/students` | Create approved student and one-time PIN |
| `GET` | `/admin/students/:id` | Student detail |
| `GET` | `/admin/students/:id/available-seats` | Seats usable for this student's assignment |
| `PATCH` | `/admin/students/:id` | Edit profile, email, seat, shift, fee, preferences |
| `PATCH` | `/admin/students/:id/status` | Approve/reject/block/unblock |
| `POST` | `/admin/students/:id/reset-pin` | Reset PIN and unlock account |
| `DELETE` | `/admin/students/:id` | Soft-delete student |
| `GET` | `/admin/students/:id/attendance` | Student attendance |
| `GET` | `/admin/sessions` | Search/filter sessions |
| `POST` | `/admin/sessions/:id/force-checkout` | Complete active session |
| `GET` | `/admin/fees` | Search/filter fees |
| `PATCH` | `/admin/fees/:id/pay` | Mark fee paid |
| `POST` | `/admin/fees/generate` | Generate fees for a month |
| `GET` | `/admin/reports/summary` | Summary and attendance series |
| `GET` | `/admin/reports/students` | Student study report |
| `GET` | `/admin/export/attendance.csv` | Attendance CSV |
| `GET` | `/admin/notifications` | Notification list |
| `GET` | `/admin/notifications/failed` | Failed/admin notification list |
| `GET` | `/admin/notifications/needs-action` | Temporarily disabled |
| `GET` | `/admin/notifications/unread-count` | Unread alert count |
| `POST` | `/admin/notifications/read-all` | Mark notifications read |
| `PATCH` | `/admin/notifications/:id/contacted` | Temporarily disabled |
| `PATCH` | `/admin/notifications/:id/read` | Mark one notification read |

## 10. Common troubleshooting

| Symptom | Check |
|---|---|
| Frontend says it cannot reach the server | Confirm backend is running on port 5000 and `/health` responds |
| Backend exits during startup | Verify `MONGODB_URI`, database access/network allowlist, and encoded URI characters |
| Registration has no seats | Confirm the seed created seats and that seats are active and unassigned |
| Registration is pending and login is denied | An admin must approve the student first |
| Check-in says seat is unavailable | Confirm the account's assigned seat is active and not occupied; ask admin to review the assignment/live seat view |
| Check-in button appears unavailable | Confirm the student is approved and authenticated; for legacy accounts select an available seat and shift |
| Admin login does not work after changing seed credentials | Seed provisions the admin from `ADMIN_PHONE` and `ADMIN_PIN`; use the current configured values |
| PIN was closed before it was saved | Admin must use **Reset PIN**; the newly generated PIN is shown once |
| SMS/WhatsApp is not delivered | Check provider mode, API credentials, approved templates, opt-in, and `/admin/alerts`; mock mode does not send live messages |
| A student cannot be deleted | Check out or force-checkout the active session first |

## 11. Release and production notes

- Use a separate production environment file and never commit it.
- Use a strong unique `JWT_SECRET`, a least-privilege database account, network
  restrictions, database backups, and HTTPS.
- Configure the frontend/API origin and production cookie/CORS settings to
  match the deployment domain.
- Build with `npm run build` in both packages and run backend tests against an
  isolated test database.
- Run one backend instance while cron jobs run in-process; multiple instances
  could run scheduled work more than once.
- Verify login, student registration/approval, admin student creation, assigned
  seat check-in/out, monthly fee generation, notifications, and restore
  procedures with test accounts before opening the service to users.
- Keep `MASTER_PLAN.md` as the original plan/checklist. This guide records the
  current user-facing workflow and notes the implemented seat/shift change.
