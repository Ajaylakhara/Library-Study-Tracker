# Library Study Tracker — Client

React 19 + TypeScript + Vite, Redux Toolkit, React Router (data router), Tailwind CSS v4, lucide-react.
Theme: **Oxford Blue & Ivory** (see `src/index.css`). The admin console follows the supplied dashboard reference: a fixed-height navy sidebar that stays visible while the dashboard scrolls, an ivory-and-gold sticky header, a tablet icon rail, and a mobile drawer.

The admin landing page (`/admin`) is the live dashboard; the detailed seat grid is available at `/admin/seats`.
The shared phone/PIN login uses the supplied split glass-panel desktop design, a compact mobile layout, a live IST clock, and reduced-motion-aware ambient animation. Students and admins continue to sign in through this same page. Admin filters and status tabs use the shared glass treatment; student pages retain the selected original dark-navigation/navy-hero prototype.
Existing admin pages now share the reference’s animated active navigation pill, responsive glass toolbars, selected-tab treatment, page transitions, and live summary cards where data is available.

## Run (development)

Start the API first (see `../server/README.md`: `npm run seed`, `npm run dev` → http://localhost:5000), then:

```bash
cd client
npm install
npm run dev        # http://localhost:5173
```

Vite proxies `/api` to `http://localhost:5000`, so the httpOnly login cookie is same-origin and no CORS setup is needed.
Default admin (from the seed): phone `9000000000`, PIN `123456`.

## Build / deploy

```bash
npm run build      # type-checks, then writes dist/
```

Serve `dist/` from Nginx on the **same domain** as the API, proxy `/api` to Node, and add an SPA fallback (`try_files $uri /index.html;`).
Set `NODE_ENV=production` on the server so cookies are `Secure`, and serve over HTTPS. Print the QR poster pointing to `https://yourdomain/login`.

> [!IMPORTANT]
> **Production API URL Configuration:**
> Before deploying, open `.env.production` and replace `VITE_API_URL` with your actual production API URL (e.g., `https://api.yourdomain.com/api` or `/api` if using reverse proxy on the same origin). Do NOT commit production secrets.

## Structure

```
src/
  app/          store, typed hooks, createAppThunk
  api/          http() fetch wrapper (credentials, error envelope, 401 handling), CSV download
  features/     Redux slices: auth, student (session + seats), ui/toast
  hooks/        useCountdown, usePolling (pauses in hidden tabs), useDebounce, useAsync, useMediaQuery
  router/       createBrowserRouter + RequireAuth / GuestOnly / RootRedirect
  layouts/      StudentLayout (header + bottom nav), AdminLayout (sidebar / rail / drawer)
  components/   ui/ (Button, Input, PinInput, Modal, Toast, Badge, States, Controls), SeatGrid, DataTable, Pagination
  pages/        auth/, student/, admin/
  utils/        format.ts (Xh Ym, IST dates, ₹), constants.ts
```

## API contract used

- Student registration and admin student creation assign a seat and study shift. Assigned seats are reserved for that student; the Home page checks in using that saved assignment.
- Admins can edit student name, phone, email, assigned seat, study shift, monthly fee, and notification preferences from the Students page.
- Students and admins use the same login form with `{ phone, pin }`; the server routes admins to the dashboard based on the account role.
- `GET /auth/seats/available` returns unassigned active seats for registration and admin student creation. `GET /me/seats/available` supports legacy students without an assignment.
- Check-in sends the student's assigned `{ seat, shiftHours }`.
- Responses are `{ success, message, data }`; errors are `{ success: false, message, errors? }`.
- Register sends `whatsappOptIn` / `smsOptIn`; approving a student sends `{ status, monthlyFee }`.
- Admins can add a student from the Students page; new students are approved immediately. A generated or supplied six-digit PIN is returned only in the creation/reset response and shown once in the share PIN dialog.

## Behaviour notes

- Countdown runs from the server's `shiftEndsAt`; it turns amber in the last 10 minutes and red (+overtime) after the shift ends.
- Seat grids refresh every 15 s and pause while the tab is hidden. New registrations and admin-added students reserve a unique seat assignment; a 409 on check-in refreshes seats and status.
- A 401, or a 403 "blocked" reply, logs the user out with a toast.
- Dark mode is not part of v1.
