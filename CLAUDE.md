# CLAUDE.md — DO Check-In System

> Handoff brief. Read this first, every session.
> Last updated 2026-07-29. The system is **live and in daily use**; the only
> feature not working end-to-end is email delivery (one external blocker, below).

---

## What this project is

A **Discipline Office (POD) check-in and admission slip system** for
**Ateneo de Iloilo – Santa Maria Catholic School (ADI–SMCS)**, Philippines.

Students self-report at an iPad kiosk for late arrivals, absences and
infractions. The system produces a digital admission slip modelled on the
school's paper form, a POD officer reviews and confirms it, and the student and
their adviser are emailed a copy.

- **Live:** https://adi.edu.ph/pod/ (Bluehost cPanel; moved off Netlify 2026-07-17)
- **Repo:** `C:\pod\DO-CheckIn` → github `mcray1/DO-CheckIn`, branch `main`
- **Scale:** ~2,061 students (Kinder–Grade 12), 175 advisers
- **Owner:** Marc (IT / system owner, `superadmin`), mihpapna@adi.edu.ph
- **Supabase project:** `ghofeoxrkrcibzeqcbih` — https://ghofeoxrkrcibzeqcbih.supabase.co
- **Handover spec:** `POD_Handover.md` — complete description of the system, written
  for the planned PHP/MariaDB rebuild as a module inside AttendTrack (ABC).
- **Database report:** `POD_Database_Report.md` — the ABC tables POD reads, how daily
  attendance is derived from them, the `pod-api.php` feed, and proposed `pod_*` DDL.

There are sibling school projects (Entrance Exam, ADI Helpdesk, AttendTrack).
**This repo is React + Supabase only** — nothing here is Google Apps Script.

---

## Architecture in one paragraph

Serverless and database-centric. There is **no backend server** — the React SPA
talks straight to Postgres through Supabase's auto-generated REST API (PostgREST),
and **Row-Level Security is the actual authorization boundary**. Two Deno edge
functions exist only for what a browser must never do: hold the service-role key
and the Gmail credentials. The anon key is public by design (it ships in the JS
bundle); nothing is protected by hiding it.

| Layer | Tech |
|---|---|
| Frontend | React 19 · Vite 8 · TypeScript · no UI framework (inline styles from `src/theme.js`) |
| Hosting | Bluehost cPanel static files at `/public_html/pod/` |
| Data + Auth | Supabase (PostgreSQL, PostgREST, Auth) |
| Server code | 2 Deno edge functions |
| Email | Gmail API, service account + domain-wide delegation, sends as pod@adi.edu.ph |
| Spreadsheets | SheetJS (`xlsx`), lazy-loaded into its own chunk |

### Build config — do not "fix" these
- `package.json` build is `vite build`, **not** `tsc -b && vite build`, and
  `tsconfig.json` has `"strict": false`. The code is plain JS/JSX inside `.tsx`
  files. Re-enabling strict typechecking breaks the build.
- `vite.config.ts` sets `base: '/pod/'` because the app is served from a
  subfolder. If this stops matching the URL, every asset 404s.

---

## Deploying (manual — there is no CI)

**Frontend**
```bash
npm run deploy:zip
```
→ produces `pod-deploy.zip` → cPanel **File Manager** → `public_html/pod/` →
Upload → **Extract** (overwrite) → delete the zip → **hard-refresh**.

**Edge functions** (run in `C:\pod\DO-CheckIn`)
```bash
npx supabase functions deploy send-notification --no-verify-jwt
npx supabase functions deploy manage-users --no-verify-jwt
```
`--no-verify-jwt` is **required**: both functions authenticate the caller
internally, and platform-level JWT verification breaks the browser's CORS
preflight before the request reaches that code.

**Migrations** — paste into the Supabase **SQL Editor** in filename order.
There is no migration runner; `supabase/migrations/` is a record of what was applied.

> **The single most common source of confusion in this project** is a stale
> frontend zip or an unapplied migration — not a bug. Before debugging anything
> odd: compare the live bundle hash (`view-source` on the live page) against
> `dist/assets/`, and confirm the relevant migration actually ran.

> **After any migration that adds a column or table**, run
> `notify pgrst, 'reload schema';` or PostgREST keeps serving its cached schema
> and returns `PGRST204` / `PGRST205` for something that demonstrably exists.

---

## Source files (`src/`)

| File | Purpose |
|---|---|
| `App.tsx` | Root: auth state, 30-min inactivity logout, routing. Contains the public **Kiosk** and the **rules classifier**. |
| `Dashboard.jsx` | POD dashboard shell: stats cards (clickable filters), filters, slips table/cards, **ConfirmModal**, tab routing. |
| `Login.jsx` / `ChangePassword.jsx` | Staff login (`@adi.edu.ph` enforced); forced password change on first login. |
| `Categories.jsx` | Admin: categories → sub-categories → classifier keywords (3-level accordion). |
| `Directory.jsx` | Admin: advisers + students CRUD, search, paging, **CSV import** for both. |
| `Users.jsx` | Admin: staff accounts (calls `manage-users`). |
| `Roles.jsx` | Superadmin: role × capability permission matrix. |
| `Settings.jsx` | Admin toggles (see Settings keys below). |
| `Reports.jsx` | Summary reports + the POD **Monitoring Sheet** (CSV + multi-tab Excel). |
| `PrintableSlip.jsx` | Print-isolated admission slip. |
| `theme.js` | Design tokens, `categoryVisual()` (per-category colour + icon). |
| `departments.js` | `departmentOf()` — PS/GS · JHS · SHS, derived from grade level. |
| `supabaseClient.js` | Supabase client (anon key — public by design). |

`index.css` is imported by `main.tsx`. **It must stay imported** — it carries the
`@media print` rules that isolate the slip. (It was silently unimported for a
while, which is why printing used to spill the whole page.)

---

## Database

### Tables
- **students** — `student_no` (unique), `name`, `level`, `section`, `gender`,
  `program`, `rfid`, `email`, `is_active`
- **teachers** (advisers in the UI) — `employee_id`, names, `email`,
  `department`, **`level`, `section`** (the advisory class — drives kiosk
  auto-assign), `is_active`
- **categories** — Late, Absent, Uniform, Hairstyle, Gadget, POST, Suspension, Others
- **sub_categories** — per category; `document_required`, `document_description`,
  `document_deadline_days`, `suggested_status`
- **keywords** — drives the classifier (`nature`, `keyword`, `weight`, `suggested_status`)
- **admission_slips** — the core record (see below)
- **profiles** — `id` = `auth.users.id`, `role`, `is_active`, `must_change_password`
- **role_permissions** — `(role, permission)` rows = the permission matrix
- **settings** — key/value JSONB
- **notification_log** — one row per email attempt; **cascades** on slip delete

### admission_slips — notable columns
`name, student_id, grade_section, category_id, nature (text[]), teacher_id/name/email,
reason, meridiem, time_arrived, date (TEXT label e.g. "Jul 28, 2026"),
ai_sub_category, ai_status, final_sub_category, status, confirmed_by, confirmed_at,
absence_date, absence_end_date, absence_days (numeric, supports .5), absence_half,
document_required/description/deadline/status,
notification_sent(+_at), student_notification_sent(+_at)`

> **`date` is TEXT, not a date.** It is the local Manila day the kiosk stamped.
> Never range-compare it (`date < '2026-07-22'` compares alphabetically and
> deletes the wrong rows). `created_at` **is** a real timestamp but stores **UTC** —
> Manila is UTC+8, so a day boundary is `16:00` the previous UTC day.
> Reports bucket by the `date` label deliberately, so days match what the POD sees.

### Views / functions
- `get_my_role()` — security-definer; **always** use this in policies. Querying
  `profiles` directly from a `profiles` policy causes infinite recursion (500).
- `has_perm(perm)` — superadmin implicitly true, else looks up `role_permissions`.
- `my_permissions()` — the caller's effective capabilities; the frontend calls
  this on load to decide which tabs/actions to show. **When adding a new
  permission you must also add it to this function's superadmin array**, or
  superadmin silently won't have it.
- `school_year_of(ts, start_month)` — parameter is `timestamp`, *not* `timestamptz`
  (Postgres won't implicitly cast, and `created_at` is plain `timestamp`).
- `student_sections` — distinct level+section actually in use; populates the
  adviser "Advisory class" dropdown so a typo can't break matching.
- `student_category_counts` — repeat-offender tallies, scoped per school year.

### Permission matrix (`role_permissions`, edited in the Roles tab)
`confirm_slips` · `manage_slips` · `manage_categories` · `manage_users` ·
`manage_settings` · `manage_directory` · `view_reports`

Roles: `superadmin` (implicitly all) > `pod_admin` > `pod_staff` > `faculty`.
`manage_slips` = correct a slip's Nature of Visit **and** delete slips —
deliberately separate from routine `confirm_slips`.

### Settings keys
`repeat_offender_threshold` · `school_year_start_month` · `maintenance_mode` ·
`maintenance_message` · `count_weekends` · `email_notifications_enabled` ·
`student_email_notifications_enabled`

Only `maintenance_mode`, `maintenance_message` and `count_weekends` are readable
by **anon** (the kiosk needs them).

---

## Security posture (audited 2026-07-22; don't regress these)

- **`send-notification` and `manage-users` authenticate the caller inside the
  function** (`getUser()` → profile → role/permission). They run with the
  service-role key, and the anon key is public, so an internal check is the only
  thing standing between the public and "send mail as pod@adi.edu.ph".
- **CORS is an exact-match allowlist** (`https://adi.edu.ph`, `www.` variant),
  echoing the caller's origin. Extra origins via the `CORS_ORIGINS` env var.
- **Anon kiosk INSERT is constrained** — a slip must arrive unreviewed
  (no status/confirmed_*), un-notified, with bounded text lengths.
- **Student email addresses are read from `students` at send time**, never from
  the slip, because the kiosk writes slips as anon and an address on the slip
  could be forged.
- **CSV/Excel exports neutralise formula injection** (`=`, `+`, `-`, `@`, tab)
  — student-typed reasons end up in spreadsheets the POD opens.
- All slip data in emails is HTML-escaped.

Known, accepted: no rate limiting on the anon kiosk endpoint (belongs at the
CDN/edge); `xlsx@0.18.5` has advisories that only affect *parsing* untrusted
files — this app only writes.

---

## How it behaves

**Kiosk (public, anon):** search student → pick Nature of Visit (colour-coded
buttons) → adviser auto-resolves from the student's level+section (falls back to
manual search) → for Absent, pick first/last day with optional half-day AM/PM →
type a reason → the rules classifier suggests a sub-category + status live →
submit. Slip saves with `status = null` (pending).

**POD dashboard:** filter by status / nature / department / repeat-offender /
today → open a slip → (admins) correct the Nature of Visit → pick sub-category →
set final status → document status → confirm. **Confirming sends the emails.**

**Classifier** (`App.tsx`, client-side only — an earlier server-API version
failed on the deployed site): matches active keywords against the reason,
tallies weighted scores per sub-category, highest wins; within it the
highest-weighted `suggested_status` wins.

**Absence day counting:** weekdays only by default (`count_weekends` toggles),
minus 0.5 per half-day boundary, minimum 0.5. The POD can override the final
number on the slip.

**Reports:** *Summary* (counts by category / department / grade level / section ×
status) and *Monitoring Sheet* (the POD's paper format: one row per slip with the
six reason columns tallied under lateness/absences bands). Exports CSV or a
multi-tab Excel workbook, one worksheet per section.

---

## Outstanding work

1. **Gmail delegation is broken — no email actually sends.**
   `invalid_grant / Not a valid email or user ID` from the Google token endpoint.
   Everything upstream is built and verified; this is the last blocker.
   Google Cloud project `DO-CheckIn-Mailer`, service account `docheckin-mailer`,
   scope `https://www.googleapis.com/auth/gmail.send`, secrets
   `GMAIL_CLIENT_EMAIL` / `GMAIL_PRIVATE_KEY` / `POD_SENDER_EMAIL` (pod@adi.edu.ph).
   Next step: delete and re-add the domain-wide delegation entry cleanly in
   admin.google.com, then confirm a slip and check `notification_log`.

2. **Advisers have no advisory class set (0 of 175).** Until they do, the kiosk
   can't auto-resolve an adviser, so most slips carry no `teacher_email` and
   adviser emails never fire. Fix via Directory → Advisers → Import CSV with
   `Employee ID, Level, Section`.

3. **16 active students have no email** (recent enrollees absent from the
   directory file). They're skipped silently.

4. Point **UptimeRobot** at `https://adi.edu.ph/pod/` (keeps Supabase free tier awake).

5. Never built: audit log, archive, faculty portal, MS Teams notifications.

---

## Working agreements (how Marc works)

- **Design-first.** Explain trade-offs and get approval before writing code.
- **One step at a time**; he tests on the live site and reports back.
- **Paste-ready output** — complete SQL and code with clear instructions.
  He applies all Supabase changes himself in the dashboard.
- Structured summary at the end of each stage.
- Secrets never in browser code — always edge-function env vars.
- Apply professional standards by default: CRUD, RBAC, validation,
  search/filter/sort, import/export, reporting, error handling, confirmations,
  responsive + accessible design, print.

---

## Reference: the POD's paper forms

- **Six lateness reasons:** Health, Traffic, OSR, Travel, Woke Up Late,
  Family Matters (OSR's meaning is still unconfirmed — leave as "OSR").
- **Monitoring Sheet** columns map to `admission_slips`: Name, Year & Section,
  Date Filed, Days Covered, Absences, Tardiness, Time, Uniform, Status, Reasons —
  plus the six reasons tallied twice (lateness band, absences band).
  The workbook keeps **one worksheet per section**; the Excel export mirrors this.
- Attendance summaries use **half-day values** (e.g. 3.5) — hence `absence_days`.
