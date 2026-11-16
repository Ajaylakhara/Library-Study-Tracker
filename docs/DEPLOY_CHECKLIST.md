# Deploy checklist (manual steps)

These are the steps only you can do. Tick them in order after pushing the code.
Replace `<backend-host>` with your backend's domain (for example
`library-study-tracker-z69g.vercel.app`) and `<frontend-host>` with the frontend's.
Never paste real secrets into chat, tickets or git; keep them in Vercel and your
password manager.

## 1. Environment variables in Vercel (Production), then redeploy

Backend project: Settings -> Environment Variables. Every name and its meaning is
in `backend/.env.example`.

- [ ] `MONGODB_URI`
- [ ] `JWT_SECRET`: **required, at least 32 random characters.** The backend will
      not start in production without it. Generate one:
      `node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"`
      (Changing it logs everyone out once.)
- [ ] `CRON_SECRET`: another random value, generated the same way
- [ ] `TELEGRAM_BOT_TOKEN`, `TELEGRAM_BOT_USERNAME`, `TELEGRAM_WEBHOOK_SECRET`
- [ ] `PUBLIC_URL` = `https://<backend-host>`
- [ ] `RUN_JOBS_IN_PROCESS` = `false`
- [ ] `OVERTIME_REPEAT_MINUTES` (`0` = no repeat alerts; for example `10` repeats
      every 10 minutes, at most 6 times)
- [ ] `CLIENT_URL` = `https://<frontend-host>`
- [ ] `SMS_ACTION_TOKEN_SECRET` and any provider keys you use

Frontend project: nothing secret is needed. `VITE_API_URL` is ignored in
production; the app always calls `/api`.

- [ ] Open `frontend/vercel.json` and check the rewrite `destination` is
      `https://<backend-host>/api/:path*`
- [ ] Redeploy **both** projects (Vercel -> Deployments -> Redeploy). Environment
      variable changes do not apply to a deployment that already exists.
- [ ] Backend deployment succeeded. If it failed on `backend/vercel.json`
      (the `functions` / `maxDuration` setting), delete that file and set
      Settings -> Functions -> Max Duration to 60 seconds instead.
- [ ] Open `https://<backend-host>/health`: it should answer `status: ok`.
      (If the backend logs `CRITICAL: JWT_SECRET`, the secret is missing or too short.)

## 2. Minute scheduler on cron-job.org

Vercel's free cron only runs once a day, so use an external scheduler.

- [ ] Create a job: URL `https://<backend-host>/api/cron/tick`, method **POST**,
      every **1 minute**
- [ ] Add the header `Authorization` = `Bearer <your CRON_SECRET value>`
- [ ] Save, then open the job's **history** and confirm responses are **200**
      (401 = wrong secret, 503 = `CRON_SECRET` not set on the backend, 500 = check
      the Vercel function logs)
- [ ] In the app, open **Alerts**: the banner should say the last background check
      was under a minute or two ago, and "Last cron run" shows queued / sent /
      failed. A red warning appears if no run happens for 3 minutes.

## 3. Telegram webhook

On your own computer, in `backend/`, with a local `.env` that holds the same
`TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET` and `PUBLIC_URL` (do not commit it):

```powershell
npm run telegram:set-webhook -- https://<backend-host>
npm run telegram:webhook-info
```

- [ ] `webhook-info` shows `url` ending in `/api/telegram/webhook`, no
      `last_error_message`, and a small `pending_update_count`

## 4. Link the admin's Telegram account

- [ ] Sign in as admin, open **Alerts**, use the Telegram card to create a link
- [ ] Open the link on your phone in a **private chat** with the bot and press
      Start (a group chat will not work)
- [ ] Back on **Alerts**, "Admin Telegram" shows **Linked**. (If it says "Not
      linked", overtime alerts cannot reach Telegram.)

## 5. End-to-end test of the overtime alert

Use a **test student**, not a real one.

- [ ] Sign in as the test student and check in (shortest shift is 4 hours)
- [ ] Wait until the shift end **plus 15 minutes**, or shorten it: in MongoDB
      (Atlas or Compass), find that session in the `sessions` collection and set
      `shiftEndsAt` to 16 minutes ago, for example in mongosh:
      `db.sessions.updateOne({ _id: ObjectId("<session id>"), status: "active" }, { $set: { shiftEndsAt: new Date(Date.now() - 16*60*1000) } })`
- [ ] Within about 1-2 minutes the admin Telegram chat receives the overtime
      alert, and the time shown is the correct IST time
- [ ] Tap **Force checkout** in the alert (or check the student out in the app) so
      the test session ends
- [ ] If nothing arrives: open **Alerts**, look at the Failed tab (the error text
      says why), fix the cause, and press **Retry failed**

## 6. Login and session check

- [ ] Sign in as admin. In the browser developer tools -> Application -> Cookies,
      the `token` cookie shows **HttpOnly**, **Secure**, **SameSite=Lax** and an
      expiry about 30 days away
- [ ] Turn the network off for a few seconds with the app open: you should see
      "Can't reach the server" and **Try again**, not the login page
- [ ] Enter a wrong PIN 5 times for a test phone number: the next attempt, even
      with the right PIN, is refused for 15 minutes with the same message you get
      for a phone number that does not exist

## 7. Tests (run on your computer)

Needs a **separate** MongoDB database whose name ends in `_test`.

```powershell
cd backend
$env:MONGODB_TEST_URI = "<your test database URI>"
npm run build
npm test

cd ../frontend
npm run typecheck
npm test
npm run build
```

## Manual test of the tick endpoint

```bash
curl -sS -X POST "https://<backend-host>/api/cron/tick" \
  -H "Authorization: Bearer $CRON_SECRET"
```

PowerShell:

```powershell
Invoke-RestMethod -Method Post -Uri "https://<backend-host>/api/cron/tick" `
  -Headers @{ Authorization = "Bearer $env:CRON_SECRET" }
```

A healthy answer looks like:

```json
{ "ok": true, "monitorRan": true, "notificationsQueued": 0, "sent": 0,
  "failed": 0, "durationMs": 420, "timedOut": false }
```

`"skipped": true` means another tick is still running (normal if you call twice
in a row). `401` = wrong secret; `503` = `CRON_SECRET` is not configured.
