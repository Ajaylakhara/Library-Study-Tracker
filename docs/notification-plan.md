# Library Study Tracker: Notification Plan (Telegram, WhatsApp, SMS)

Date: 26 Oct 2026. This plan extends the Master Plan (23 Oct 2026). It replaces the Meta WhatsApp API and the paid SMS provider.

## 1. Goal

Admin gets alerts in a Telegram bot (free, automatic).

Each student picks one channel: WhatsApp, SMS or Telegram.

WhatsApp and SMS are sent from the admin’s own phone using ready links. The server only prepares the message. This is free and needs no Meta approval and no DLT.

Telegram is the only fully automatic channel for students.

The bot is yours. An admin must request access once, and you approve it in Telegram.

## 2. New decisions (add to section 1 of the Master Plan)

| # | Decision | Final answer |
|---|---|---|
| 13 | Admin alerts | Telegram bot only. |
| 14 | Student channel | Student picks one preferredChannel: whatsapp, sms or telegram. Default is whatsapp. |
| 15 | WhatsApp | Admin taps a green button. It opens wa.me with the message typed. |
| 16 | SMS | Admin taps a blue button. It opens the phone’s SMS app with the message typed (sms: link). On a desktop, show “Copy message”. |
| 17 | Telegram for students | Optional. If the student links the bot, messages are sent automatically. If not linked, fall back to WhatsApp. |
| 18 | Who can change the channel | The student on Profile, or the admin in the student’s edit modal. Register has a 3-option choice. |
| 19 | Bot owner | You. Your Telegram ID is in .env as OWNER_TELEGRAM_ID. |
| 20 | Admin access | One-time request, approved by the owner. Until approved, no alerts and no commands. |
| 21 | Owner controls | /requests, /admins and a Revoke button. |
| 22 | Students | No owner approval. They link with their own code. |
| 23 | Owner is also admin | If the chat ID equals OWNER_TELEGRAM_ID, approve automatically. |
| 24 | Removed | Meta WhatsApp API, SMS provider, DLT, and the fields whatsappOptIn, smsOptIn, telegramOptIn. |
| 25 | Bot mode | Webhook on your HTTPS domain. One server instance only. |

## 3. How it works

### 3.1 One-time owner setup

1. Create the bot in @BotFather. Save the token in .env.
2. Open your bot and send /myid. It replies with your numeric Telegram ID.
3. Put that number in .env as OWNER_TELEGRAM_ID. Restart the server.

### 3.2 Admin request (one time)

1. Admin opens Settings and taps “Connect Telegram”. Status: Not connected.
2. The server makes a 10-minute code. The admin opens t.me/YourBot?start=CODE.
3. The bot saves the chat as pending and says: “Request sent. Waiting for owner approval.”
4. Settings shows Waiting for owner approval.

### 3.3 Owner approval

1. You get a message: “Access request, name, phone” with Approve and Reject buttons.
2. Tap Approve. The admin gets “Connected. You will now get alerts here.”
3. The bot now sends alerts and accepts /live, /pending and /unpaid from that admin.
4. Later, /admins shows approved admins with a Revoke button. Blocked or deleted admins are revoked automatically.

### 3.4 Message flow for students

1. The shift monitor creates a notification (reminder, shift ended, overtime, fee unpaid).
2. The server reads the student’s preferredChannel:
   - telegram and linked: the bot sends it. Status sent.
   - telegram but not linked: use whatsapp.
   - whatsapp or sms: save as manual_pending with the message text.
3. Admin opens Alerts, tab “To send”. Each row shows the name, the message and one button for the student’s channel.
4. Admin taps the button, sends the message, then taps “Mark sent”.

Links the server builds (phone stored as 10 digits):

- WhatsApp: `https://wa.me/91XXXXXXXXXX?text=<encodeURIComponent(message)>`
- SMS: `sms:+91XXXXXXXXXX?body=<encodeURIComponent(message)>`

Test the SMS link on both Android and iPhone.

## 4. Database changes

### Admin User

| Field | Type | Meaning |
|---|---|---|
| telegramStatus | none, pending, approved, revoked, rejected | Default none |
| telegramPendingChatId | String | Saved at /start, before approval |
| telegramChatId | String (unique sparse) | Set only after approval |
| telegramRequestedAt | Date | Pending requests older than 24 hours expire |
| telegramLinkCode, telegramLinkExpires | String, Date | One-time code, deleted when used |

### Student User

Add `preferredChannel` (whatsapp, sms, telegram; default whatsapp), `telegramChatId` (unique sparse), `telegramLinkCode`, and `telegramLinkExpires`. Remove `whatsappOptIn` and `smsOptIn`.

### Notification

`channel` is telegram, whatsapp or sms. `status` is pending, sent, failed or manual_pending. Store `message` (String). Keep the unique index so each alert fires exactly once.

## 5. API contract changes

| Endpoint | Request → Response |
|---|---|
| POST /auth/register | `{ name, phone, pin, preferredChannel }` → `{ message }` |
| PATCH /me/profile | add `preferredChannel` |
| POST /me/telegram/link | → `{ link }` |
| DELETE /me/telegram/link | → `{ message }` |
| POST /admin/students | `{ name, phone, pin?, monthlyFee, preferredChannel }` → `{ student, pin }` |
| PATCH /admin/students/:id | add `preferredChannel` |
| POST /admin/telegram/link | → `{ link }` |
| GET /admin/telegram/status | → `{ status, connected }` |
| DELETE /admin/telegram/link | → `{ message }` (disconnect or cancel pending) |
| GET /admin/notifications/manual | → `{ items: [{ id, studentName, message, channel, link }] }` |
| PATCH /admin/notifications/:id/mark-sent | → `{ message }` |
| POST /telegram/webhook | Telegram update → 200 OK |

## 6. Webhook setup

### Step 1: `.env`

```dotenv
TELEGRAM_BOT_TOKEN=123456:ABC...
TELEGRAM_WEBHOOK_SECRET=long_random_string_letters_numbers_underscore_dash_only
BOT_USERNAME=YourLibraryBot
OWNER_TELEGRAM_ID=123456789
PUBLIC_URL=https://yourdomain.com
```

### Step 2: Express route (use `express.json()` before it)

```ts
// routes/telegram.ts
router.post('/telegram/webhook', async (req, res) => {
  if (req.get('X-Telegram-Bot-Api-Secret-Token') !== process.env.TELEGRAM_WEBHOOK_SECRET) {
    return res.sendStatus(401);
  }
  res.sendStatus(200); // answer fast, then process
  handleUpdate(req.body).catch((e) => console.error('telegram update failed', e.message));
});
```

### Step 3: register the webhook (once)

```sh
curl -X POST "https://api.telegram.org/bot<TOKEN>/setWebhook" \
  -d "url=https://yourdomain.com/api/telegram/webhook" \
  -d "secret_token=<TELEGRAM_WEBHOOK_SECRET>" \
  -d 'allowed_updates=["message","callback_query"]' \
  -d "drop_pending_updates=true"
```

### Step 4: check it

```sh
curl "https://api.telegram.org/bot<TOKEN>/getWebhookInfo"
```

Look for the url set, pending_update_count near 0 and no last_error_message.

### Step 5: bot menu commands

```sh
curl -X POST "https://api.telegram.org/bot<TOKEN>/setMyCommands" \
  -H "Content-Type: application/json" \
  -d '{"commands":[
    {"command":"live","description":"Seats free and occupied"},
    {"command":"pending","description":"Students waiting for approval"},
    {"command":"unpaid","description":"Unpaid fees this month"},
    {"command":"requests","description":"Owner: admin access requests"},
    {"command":"admins","description":"Owner: approved admins"}
  ]}'
```

Remove the webhook (when moving servers):

```sh
curl -X POST "https://api.telegram.org/bot<TOKEN>/deleteWebhook"
```

Local testing: Telegram needs a public HTTPS URL. Run `npx cloudflared tunnel --url http://localhost:5000` (or ngrok) and use that URL in setWebhook. Run setWebhook again with the real domain before deploying.

Nginx: the existing `/api` proxy already covers this route. Webhooks work only on ports 443, 80, 88 or 8443. You use 443.

## 7. Bot code

```ts
// telegram/handleUpdate.ts
const OWNER = String(process.env.OWNER_TELEGRAM_ID);

export async function handleUpdate(update: any) {
  if (update.callback_query) return handleCallback(update.callback_query);
  const msg = update.message;
  if (!msg?.text) return;
  const chatId = String(msg.chat.id);
  const [cmd, arg] = msg.text.trim().split(/\s+/);

  if (cmd === '/myid') return sendMessage(chatId, `Your Telegram ID: ${chatId}`);
  if (cmd === '/start') return handleStart(chatId, arg);

  if (chatId === OWNER) {
    if (cmd === '/requests') return listRequests(chatId);
    if (cmd === '/admins') return listAdmins(chatId);
  }

  const admin = await User.findOne({ telegramChatId: chatId, telegramStatus: 'approved', role: 'admin' });
  if (!admin) return; // stay silent for strangers
  if (cmd === '/live') return sendLive(chatId);
  if (cmd === '/pending') return sendPending(chatId);
  if (cmd === '/unpaid') return sendUnpaid(chatId);
}

async function handleStart(chatId: string, code?: string) {
  if (!code) return sendMessage(chatId, 'Open the link from the web app Settings to connect.');

  const admin = await User.findOneAndUpdate(
    { role: 'admin', telegramLinkCode: code, telegramLinkExpires: { $gt: new Date() } },
    { $set: { telegramPendingChatId: chatId, telegramStatus: 'pending', telegramRequestedAt: new Date() },
      $unset: { telegramLinkCode: 1, telegramLinkExpires: 1 } },
    { new: true }
  );
  if (admin) {
    if (chatId === OWNER) return approveAdmin(String(admin._id));
    await sendMessage(chatId, 'Request sent. Waiting for owner approval.');
    return sendMessage(OWNER, `Access request\nName: ${admin.name}\nPhone: ${admin.phone}`, [[
      { text: 'Approve', callback_data: `ap:${admin._id}` },
      { text: 'Reject', callback_data: `rj:${admin._id}` },
    ]]);
  }

  const student = await User.findOneAndUpdate(
    { role: 'student', telegramLinkCode: code, telegramLinkExpires: { $gt: new Date() } },
    { $set: { telegramChatId: chatId }, $unset: { telegramLinkCode: 1, telegramLinkExpires: 1 } }
  );
  if (student) return sendMessage(chatId, 'Connected. You will get reminders here.');

  return sendMessage(chatId, 'This link is wrong or expired. Create a new one in the app.');
}

async function handleCallback(cb: any) {
  const from = String(cb.from.id);
  await answerCallbackQuery(cb.id);
  if (from !== OWNER) return; // only the owner can press these
  const [action, id] = String(cb.data).split(':');
  if (action === 'ap') await approveAdmin(id);
  if (action === 'rj') await rejectAdmin(id);
  if (action === 'rv') await revokeAdmin(id);
  await editMessageText(cb.message.chat.id, cb.message.message_id, `Done: ${action}`);
}

async function approveAdmin(id: string) {
  const a = await User.findOneAndUpdate(
    { _id: id, role: 'admin', telegramStatus: 'pending' }, // atomic: works only once
    [{ $set: { telegramChatId: '$telegramPendingChatId', telegramStatus: 'approved' } },
      { $unset: 'telegramPendingChatId' }],
    { new: true }
  );
  if (a?.telegramChatId) await sendMessage(a.telegramChatId, 'Connected. You will now get alerts here.');
}

async function rejectAdmin(id: string) {
  const a = await User.findOneAndUpdate(
    { _id: id, telegramStatus: 'pending' },
    { $set: { telegramStatus: 'rejected' }, $unset: { telegramPendingChatId: 1 } }
  );
  if (a) await sendMessage(a.telegramPendingChatId!, 'Your request was rejected by the owner.');
}

async function revokeAdmin(id: string) {
  const a = await User.findOneAndUpdate(
    { _id: id, telegramStatus: 'approved' },
    { $set: { telegramStatus: 'revoked' }, $unset: { telegramChatId: 1 } }
  );
  if (a) await sendMessage(OWNER, `Revoked: ${a.name}`);
}
```

Worker rule: admin alerts go only to admins with `telegramStatus: 'approved'` and a `telegramChatId`.

## 8. Tasks

### Backend

| ID | Task | Done when |
|---|---|---|
| T1 | Create the bot, add .env values, write providers/telegram.ts with sendMessage(chatId, text, buttons?). | A test message reaches your phone. |
| T2 | Webhook route with secret check. Handle /myid and /start CODE. Link endpoints for admin and student. | Linking works. A wrong or expired code is rejected. |
| T3 | Worker routes by preferredChannel, with the Telegram fallback to WhatsApp. | Each channel gets the right status. Each alert fires once. |
| T4 | Inline buttons and the /live, /pending and /unpaid commands. | A stranger gets nothing. Approve student works from Telegram. |
| T5 | GET /admin/notifications/manual with wa.me or sms: link. PATCH .../mark-sent. | The list shows correct links. Sent items disappear. |
| T6 | Owner approval flow: pending, approve, reject, revoke, /requests, /admins. | The admin gets “Request sent”. You approve. The admin gets “Connected”. |
| T7 | GET /admin/telegram/status. The worker and commands check approved. Auto revoke if the admin is blocked. | Pending and revoked admins get no alerts. |

### Frontend

| ID | Task | Done when |
|---|---|---|
| FT1 | Admin Settings: Connect Telegram, status, Disconnect. | The admin can request access from the web app. |
| FT2 | Alerts, tab “To send”: one green WhatsApp or one blue SMS button per row, “Copy message”, “Mark sent”. Show a red count of unsent messages. | Tapping opens the right app with text ready. |
| FT3 | 3-option channel picker in Register, Add student, Edit student and Profile. Telegram shows the link button. | The student can change channel at any time. |
| FT4 | Settings shows Not connected, Waiting for owner approval, Connected, Rejected or Revoked. Poll every 15 s while pending. | The state changes without reloading. |

### Tests to add to B9

Remove: “WhatsApp to SMS fallback”.

Add: whatsapp student gets a wa.me link; sms student gets an sms: link; telegram student without link falls back to whatsapp; changing channel affects the next alert only; Telegram send failure becomes failed; unknown chat ID is rejected; link code expires.

Owner approval: admin /start creates pending, not connected; a stranger pressing Approve is ignored; owner Approve connects once and a second press does nothing; pending admin gets no alerts; revoked admin gets no alerts; owner chat ID is auto approved; expired pending request cannot be approved.

## 9. Step-by-step build order

| Day | Work | Check before moving on |
|---|---|---|
| 1 | T1, T2 | Test message arrives. /start CODE links a student. |
| 2 | T6, T7 | Request, approve, revoke all work from Telegram. |
| 3 | T3, T4, T5 | All three channels produce the right result. |
| 4 | FT1, FT4 | Settings shows each admin state. |
| 5 | FT2, FT3 | Alerts tab and channel picker work on a real phone. |
| 6 | B9 test updates, cleanup, deploy, setWebhook | All tests pass. getWebhookInfo has no errors. |

Remove the line “Start the DLT and WhatsApp approvals in week 1” from the Master Plan build order.

## 10. Security rules

- Keep the bot token and webhook secret only in .env. Never commit them.
- Check the X-Telegram-Bot-Api-Secret-Token header on every webhook call.
- Check cb.from.id (the person who pressed) against OWNER_TELEGRAM_ID for Approve, Reject and Revoke.
- Act only on chat IDs saved in your database. Ignore strangers silently.
- Link codes are random, single-use and expire in 10 minutes.
- Never send a PIN or password through Telegram. The “Share this PIN” card stays in the web app.
- Telegram approval is for alerts only. Web login stays phone + password.
- If you lose your Telegram account, change OWNER_TELEGRAM_ID in .env and restart.

## 11. Limits to remember

- WhatsApp and SMS are sent by a person. If the admin forgets, the student gets nothing. Watch the unsent count.
- Encourage Telegram at registration for fully automatic reminders.
- Run one server instance only, because cron runs inside the Node process.

## 12. Prompts to paste

Paste Prompt 0 from the Master Plan first, then one task prompt at a time.

### T1 + T2

```text
Task T1+T2. Replace WhatsApp/SMS with a Telegram bot. Use plain fetch to the Bot API.
Add providers/telegram.ts with sendMessage(chatId, text, buttons?), answerCallbackQuery
and editMessageText. Add POST /api/telegram/webhook that checks the
X-Telegram-Bot-Api-Secret-Token header, replies 200 at once, then handles /myid and
"/start CODE": find a user by telegramLinkCode (not expired), save the chat, clear the code.
Add POST /admin/telegram/link and POST /me/telegram/link that create a random single-use
code (10 min) and return { link: "https://t.me/BOT_USERNAME?start=CODE" }. Add DELETE
versions to unlink. Update the User model: remove whatsappOptIn/smsOptIn, add
preferredChannel ('whatsapp'|'sms'|'telegram', default 'whatsapp'), telegramChatId
(unique sparse), telegramLinkCode, telegramLinkExpires. Never log tokens or codes.
```

### T6 + T7

```text
Task T6-T7. Add owner approval for admin Telegram access. .env has OWNER_TELEGRAM_ID.
Admin User gets telegramStatus ('none'|'pending'|'approved'|'revoked'|'rejected', default
'none'), telegramPendingChatId, telegramChatId (unique sparse), telegramRequestedAt. "/start CODE"
with an admin code saves telegramPendingChatId, sets status 'pending', clears the code, tells the
admin "Request sent. Waiting for owner approval." and sends the owner a message with Approve/Reject
inline buttons (callback_data "ap:<id>" / "rj:<id>"). If the chat ID equals OWNER_TELEGRAM_ID,
approve at once. Callback queries are accepted only from OWNER_TELEGRAM_ID (check cb.from.id).
Approve is an atomic update (only from 'pending'), moves the pending chat ID to telegramChatId and
messages the admin "Connected". Add owner commands /requests and /admins with Revoke buttons
("rv:<id>"). Admin commands and alerts work only when telegramStatus is 'approved'. Auto revoke if
the admin is blocked. Add GET /admin/telegram/status. Ignore strangers silently.
```

### T3 + T4 + T5

```text
Task T3-T5. Update jobs/notificationWorker.ts: admin alerts go to approved admins' Telegram
chats. For students: telegram + telegramChatId linked -> send via Telegram; telegram but not
linked -> use 'whatsapp'; whatsapp or sms -> save status "manual_pending" with the message
text. Keep the unique index so each alert fires once; failed sends become "failed" with an
error. Bot: Approve/Reject inline buttons on new-student alerts, and commands /live, /pending,
/unpaid for approved admins only. Add GET /admin/notifications/manual returning
{ items: [{ id, studentName, message, channel, link }] } where link is
https://wa.me/91<phone>?text=<encoded> for whatsapp and sms:+91<phone>?body=<encoded> for sms.
Add PATCH /admin/notifications/:id/mark-sent.
```

### FT1-FT3

```text
Task FT1-FT3. Add RTK Query endpoints for Telegram link, unlink, status and manual
notifications. Build: Admin Settings "Connect Telegram" (opens the returned link, shows
status, Disconnect with ConfirmDialog). Alerts page tab "To send": for each item show
student name, message and ONE button: green "WhatsApp" (href = link) if channel is whatsapp,
blue "SMS" (href = link) if sms, plus "Copy message" and "Mark sent"; show a red count of
unsent items. Student Profile, Register and Admin Add/Edit student: a 3-option picker
(WhatsApp, SMS, Telegram) for preferredChannel; when Telegram is selected show the
"Connect Telegram" flow. Remove the old opt-in checkboxes. Update zod schemas. Include
Skeleton, EmptyState and ErrorState.
```

### FT4

```text
Task FT4. Admin Settings Telegram section: use GET /admin/telegram/status with
pollingInterval 15000 while status is 'pending'. Show Not connected, Waiting for owner approval,
Connected, Rejected or Revoked. "Connect Telegram" shows when status is none, rejected or revoked.
Disconnect (ConfirmDialog) calls DELETE /admin/telegram/link. Invalidate the Telegram tag after
each mutation. Include Skeleton and ErrorState.
```

### B9 test update

```text
Task B9-update. Remove the "WhatsApp to SMS fallback" test. Add Jest + supertest tests for:
whatsapp student gets a wa.me link, sms student gets an sms: link, telegram student without
link falls back to whatsapp, changing channel affects the next alert only, Telegram send
failure becomes failed, webhook rejects a wrong secret header, link code expires, admin
/start creates pending, a stranger pressing Approve is ignored, owner Approve connects once,
pending and revoked admins get no alerts, owner chat ID is auto approved.
```

## 13. Testing checklist

- [ ] getWebhookInfo shows the URL and no error.
- [ ] /myid returns your ID.
- [ ] Admin taps Connect Telegram and sees “Waiting for owner approval”.
- [ ] You approve in Telegram. Settings changes to Connected without reload.
- [ ] A stranger sending /live gets no reply.
- [ ] A stranger cannot press Approve.
- [ ] A pending or revoked admin gets no alerts.
- [ ] WhatsApp student: the green button opens WhatsApp with the text ready.
- [ ] SMS student: the blue button opens the SMS app with the text ready (Android and iPhone).
- [ ] Telegram student linked: the reminder arrives automatically.
- [ ] Telegram student not linked: gets a WhatsApp item in “To send”.
- [ ] Each alert fires once, even after a server restart.
- [ ] “Mark sent” removes the item from the list.
- [ ] Revoke from Telegram stops the admin’s alerts at once.

## 14. Cleanup

- Delete the Meta WhatsApp and SMS provider files, their env keys, and the DLT notes in the deploy section.
- Remove whatsappOptIn and smsOptIn from the models, zod schemas, forms and API types.
- Update the Master Plan sections 5, 6, 7, 9 and 10 with the changes above.
- Commit after every finished task.
