# POD Check-In — System Handover

**App:** Discipline Office (POD) Check-In and Admission Slip System
**School:** Ateneo de Iloilo – Santa Maria Catholic School (ADI–SMCS)
**Owner:** Marc (IT / system owner, `superadmin`)
**Current stack:** React 19 + Vite SPA, Supabase (PostgreSQL, PostgREST, Auth), two Deno edge functions. Static files on Bluehost cPanel at `https://adi.edu.ph/pod/`.
**Purpose of this document:** a complete description of what POD does and how, written so it can be rebuilt as a PHP 8 / MariaDB module inside AttendTrack (ABC) without reading the React source. Everything here was taken from the code on branch `main` at commit `24fcf45` (2026-09-16). Where a fact is inferred rather than read from a migration, it says so.

Sections marked **▶ Port** are recommendations for the rebuild, not descriptions of current behaviour. §17 lists behaviour that should be fixed in the port rather than carried over. §18 is the data-migration mapping.

---

## 1. What the system is

Students report to the Discipline Office for late arrival, absence, and infractions. Instead of a paper admission slip, they self-report at an iPad kiosk. The system:

1. Records a **slip** with the student, the **Nature of Visit** (category), the adviser, the reason in the student's own words, and, for absences, the days covered.
2. Suggests a **sub-category** and a **status** from the reason text using a keyword classifier, live as the student types.
3. Shows a preview slip the student can print, then tells them to see the POD officer.
4. Lets POD staff **confirm** the slip: pick the final sub-category, set the final status (Excused / Unexcused / Admit Temporarily), track a required document, override the absence day count, correct a mis-tapped category, or delete the slip.
5. On confirmation, **emails** the adviser and the student a formal record of the slip.
6. Flags **repeat offenders** per school year, and produces the POD's **Monitoring Sheet** and summary reports as CSV or a multi-tab Excel workbook.

Scale: about 2,060 students (Kinder to Grade 12), 175 advisers, a handful of POD staff accounts. In daily use since July 2026.

---

## 2. Actors and roles

| Actor | How they reach the system | What they do |
|---|---|---|
| Student | Public kiosk, no login | Files a slip, prints the preview |
| POD staff (`pod_staff`) | Login | Confirms slips |
| POD admin (`pod_admin`) | Login | Everything staff does, plus categories, directory, users, settings, reports, slip correction and deletion (per matrix) |
| Superadmin (`superadmin`) | Login | Everything, implicitly; only role that edits the permission matrix |
| Faculty (`faculty`) | Login | Defined in the rank ladder but never assignable from the UI; holds no default permissions |
| Adviser | Email only | Receives a copy of each confirmed slip for their advisory class |

Rank ladder, used only by user management: `superadmin` (3) > `pod_admin` (2) > `pod_staff` (1) > `faculty` (0). A user may act on, and assign, roles **strictly below** their own, and never on their own account.

**▶ Port.** ABC's `users.role` enum is `superadmin / admin / adviser / teacher`. Map `pod_admin` → `admin`, and add a `pod` role (or a `pod_staff` flag) for POD staff who are not attendance admins. Advisers already exist as ABC users with `section_id`, which gives them a read-only view of their own section's slips for free if wanted.

---

## 3. Permission matrix

Seven capabilities. A `(role, permission)` row in `role_permissions` means granted. `superadmin` holds all seven implicitly and is not stored.

| Permission | Gates | Default grant |
|---|---|---|
| `confirm_slips` | Opening the confirm modal; updating a slip's sub-category, status, document status, absence days | `pod_admin`, `pod_staff` |
| `manage_slips` | Changing a slip's Nature of Visit; deleting a slip | `pod_admin` |
| `manage_categories` | Categories, sub-categories, keywords | `pod_admin` |
| `manage_users` | Users tab and the user-management function | `pod_admin` |
| `manage_directory` | Advisers and students CRUD and CSV import | `pod_admin` |
| `manage_settings` | Settings tab and writes to `settings` | `pod_admin` |
| `view_reports` | Reports tab | `pod_admin` |

The frontend fetches the caller's effective permissions once on load (`my_permissions()`) to decide which tabs and buttons to show. The database policies are the real enforcement; the UI is a courtesy.

`manage_slips` is deliberately separate from `confirm_slips`: routine confirmation is every staff member's job, rewriting or destroying a record is not.

**▶ Port.** Keep the matrix as data (`pod_role_perms(role, permission)`), edited by superadmin only, with superadmin implicit-all. Add a `pod_can($user, $perm)` helper beside ABC's `require_role`. Every API action checks it server-side. See §17 for the two places the current system's function checks disagree with the matrix.

---

## 4. Data model

Types are PostgreSQL. Tables marked *(inferred)* have no CREATE in the repo; their columns are taken from how the code reads and writes them.

### 4.1 `students` *(inferred)*

| Column | Type | Notes |
|---|---|---|
| `id` | integer | PK |
| `student_no` | text | Unique. The school-issued number; the join key everywhere |
| `name` | text | As in the registrar workbook, e.g. `DELA CRUZ, JUAN` |
| `level` | text | e.g. `Grade 9`, `Kinder`, `Prep` |
| `section` | text | e.g. `Obedience` |
| `gender`, `program`, `rfid` | text | From the workbook; unused by POD logic |
| `email` | text | Student school email. Null for pupils without one. Read at send time (§8.4) |
| `is_active` | boolean | Default true. Deactivate, never delete, so slips keep their history |

Readable by the public kiosk (anon), writable with `manage_directory`.

### 4.2 `teachers` (advisers in the UI) *(inferred)*

| Column | Type | Notes |
|---|---|---|
| `id` | integer | PK |
| `employee_id` | text | Optional; first match key for CSV import |
| `first_name`, `last_name`, `middle_name` | text | Displayed as `Last, First Middle` |
| `email` | text | Second match key for import; notification recipient |
| `department` | text | Free text |
| `level`, `section` | text | The advisory class. Drives kiosk auto-assign (§5.3). Indexed together |
| `is_active` | boolean | |

Readable by the public kiosk, writable with `manage_directory`.

### 4.3 `categories` (Nature of Visit) *(inferred)*

| Column | Type | Notes |
|---|---|---|
| `id` | integer | PK |
| `name` | text | `Late`, `Absent`, `Uniform`, `Hairstyle`, `Gadget`, `POST`, `Suspension`, `Others` |
| `description` | text | Shown as the button tooltip |
| `requires_reason` | boolean | Kiosk shows the reason box and requires ≥ 10 characters |
| `requires_teacher` | boolean | Kiosk requires an adviser |
| `has_sub_categories` | boolean | Admin flag only; the kiosk ignores it |
| `is_active` | boolean | Inactive categories disappear from the kiosk but stay on old slips |
| `sort_order` | integer | Button order |

Public read; writes need `manage_categories`.

**The kiosk keys three behaviours on the category *name*:** the absence-date block appears only when `name = 'Absent'`, the A.M./P.M. picker only when `name = 'Late'`, and `meridiem` is stored only for `Late`. Renaming those two categories breaks the kiosk.

**▶ Port.** Replace the name checks with two boolean columns, `asks_absence_dates` and `asks_meridiem`.

### 4.4 `sub_categories` *(inferred)*

| Column | Type | Notes |
|---|---|---|
| `id` | integer | PK |
| `category_id` | integer | FK → categories |
| `name` | text | e.g. `Traffic` |
| `suggested_status` | text | One of the three statuses (§6.1). Shown in admin; the classifier uses the keyword's status, not this |
| `document_required` | boolean | |
| `document_description` | text | e.g. `Medical certificate` |
| `document_deadline_days` | integer | Days from filing to the deadline |
| `is_active`, `sort_order` | | |

Public read; writes need `manage_categories`. Historical slips store the sub-category **name** as text, so renaming keeps old slips readable but disconnects them.

Seed for `Late`, in order: Health (1), Traffic (2), OSR (3), Travel (4), Woke Up Late (5), Family Matters (6), Weather / Calamity (7), School-related (8). These first six are the paper form's reason columns (§10.2). The meaning of OSR is unconfirmed; it has no keywords on purpose so the classifier can never suggest it.

### 4.5 `keywords` *(inferred)*

| Column | Type | Notes |
|---|---|---|
| `id` | integer | PK |
| `nature` | text | The category **name** this keyword applies to, or `Any` |
| `sub_category_id` | integer | FK → sub_categories |
| `keyword` | text | Stored lowercase; matched as a substring |
| `suggested_status` | text | Status this match votes for |
| `weight` | integer | ≥ 1 |
| `is_active` | boolean | |

Public read; writes need `manage_categories`. Keywords are not referenced by slips, so they may be hard-deleted.

Seed for Travel: `from province` 2, `out of town` 2, `province` 1, `long commute` 1, `far from school` 1, `lives far` 1, `traveled` 1, `travelled` 1, all `Admit Temporarily`.

**▶ Port.** `nature` should become a nullable `category_id` (null = Any). Matching on the category name is a second place a rename breaks things.

### 4.6 `admission_slips` *(inferred)* — the core record

| Column | Type | Written by | Notes |
|---|---|---|---|
| `id` | integer | DB | PK. Shown as `REF #id` in emails |
| `created_at` | timestamp | DB default | **Stored in UTC** despite being `timestamp without time zone`. Manila is UTC+8 |
| `updated_at` | timestamptz | dashboard | |
| `name` | text ≤120 | kiosk | Student name snapshot |
| `student_id` | text ≤40 | kiosk | The student's `student_no` (column name is misleading) |
| `grade_section` | text ≤80 | kiosk | `level - section`, e.g. `Grade 9 - Obedience`; `level` alone if no section |
| `category_id` | integer | kiosk, dashboard | FK → categories |
| `nature` | text[] | kiosk, dashboard | Always a **single-element** array holding the category name. Legacy shape |
| `teacher_id` | integer | kiosk | FK → teachers, or null |
| `teacher_name`, `teacher_email` | text (email ≤160) | kiosk | Snapshots. `teacher_email` is what the notification uses (§17) |
| `reason` | text ≤500 | kiosk | Student-typed. Null if blank |
| `meridiem` | text | kiosk | `A.M.` or `P.M.`, Late only |
| `time_arrived` | text | kiosk | `hh:mm AM` local, stamped for every slip |
| `date` | text | kiosk | **Text label**, `Sep 16, 2026` (en-US short month). The local Manila day. Reports bucket by this |
| `absence_date`, `absence_end_date` | date | kiosk | First and last day. Equal for a single day. Null unless Absent |
| `absence_days` | numeric(4,1) | kiosk, dashboard | Fractional count (§5.5). POD may override |
| `absence_half` | text | kiosk | `morning`, `afternoon`, or `first day afternoon, last day morning` |
| `ai_sub_category` | text | kiosk | Classifier suggestion (name) |
| `ai_status` | text | kiosk | Classifier suggestion |
| `ai_explanation` | text | kiosk | Human sentence, never shown after filing |
| `status` | text | dashboard | Null = pending. Else `Excused` / `Unexcused` / `Admit Temporarily` |
| `final_sub_category` | text | dashboard | Name chosen at confirmation |
| `confirmed_by` | text | dashboard | Staff full name or email |
| `confirmed_at` | timestamptz | dashboard | |
| `document_required` | boolean | kiosk | From the suggested sub-category |
| `document_description` | text | — | **Never written by the kiosk** (§17). Displayed by the modal and email |
| `document_deadline` | text | kiosk | Text label `Mon D, YYYY`, filing day + `document_deadline_days` |
| `document_status` | text | kiosk, dashboard | `Not Required` / `Promised` / `Received` |
| `notification_sent`, `notification_sent_at` | boolean, timestamptz | function | Adviser email done |
| `student_notification_sent`, `student_notification_sent_at` | boolean, timestamptz | function | Student email done |
| `school_year` | text | — | Exists, never populated. Derived instead (§11.2) |

Access: public kiosk may **insert** under the constraints in §5.7; `confirm_slips` may update; `manage_slips` may delete; authenticated staff may read all rows.

**▶ Port.** `pod_slips` with `student_no` FK → ABC `students`, `section_id` FK → ABC `sections` plus a `section_label` snapshot, `category_id` FK plus `category_name` snapshot (drop the array), `adviser_user_id` FK → ABC `users` plus a name snapshot, `filed_at DATETIME` and `filed_date DATE` in Manila time (drop the text `date`, `time_arrived`, and the UTC `created_at`), `document_deadline DATE`. Everything else maps one to one.

### 4.7 `profiles` (staff accounts)

`id uuid` = `auth.users.id`, `email`, `full_name`, `role` text, `is_active` boolean, `must_change_password` boolean (default false), `created_at`, `updated_at`. A trigger `handle_new_user` inserts a default row when an auth user is created *(inferred from the user-management function)*.

**▶ Port.** ABC `users`. `must_change_password` ≡ ABC `must_set_password`.

### 4.8 `role_permissions`

`(role text, permission text)` primary key. Readable by any signed-in user, writable by superadmin only. Seeds in §3.

### 4.9 `settings`

`key text` PK, `value jsonb`, `updated_at`. Any signed-in user reads all keys; `manage_settings` writes. **Anon may read only** `maintenance_mode`, `maintenance_message`, `count_weekends`.

| Key | Default | Meaning |
|---|---|---|
| `repeat_offender_threshold` | `3` | Slips in any single category, in the current school year, that flag a student |
| `school_year_start_month` | `6` | Month the school year begins (June) |
| `maintenance_mode` | `false` | Kiosk shows a closed screen; staff still log in |
| `maintenance_message` | text | Shown on that screen |
| `count_weekends` | `false` | Whether Sat/Sun count in absence totals |
| `email_notifications_enabled` | `true` | Adviser emails |
| `student_email_notifications_enabled` | `true` | Student emails |

**▶ Port.** ABC `settings` with a `pod_` prefix.

### 4.10 `notification_log`

One row per email attempt: `id`, `slip_id` FK → admission_slips **on delete cascade**, `channel` (`email`), `recipient_email`, `subject`, `status` (`pending` → `sent` | `failed`), `attempts`, `error_message`, `sent_at`, `created_at` *(inferred)*.

**▶ Port.** ABC `mail_queue` already has status, attempts, last_error, sent_at. Add a `pod_slip_notifications(slip_id, recipient_kind, mail_id)` link table so a slip can find its mails and the cascade survives.

### 4.11 Views and functions

- `student_sections` — distinct `(level, section)` actually present in `students`. Populates the adviser "Advisory class" dropdown so a typo can't break matching. Public read.
- `student_category_counts` — `(student_id, name, category, school_year, cnt)`: slips per student per category per derived school year. Used for repeat-offender flags.
- `school_year_of(ts timestamp, start_month int)` → `'2026-2027'` (§11.2).
- `get_my_role()`, `has_perm(perm)`, `my_permissions()` — security-definer helpers behind every policy.
- `clear_my_password_flag()` — the only way a user clears their own `must_change_password`.

---

## 5. Kiosk (public, no login)

The kiosk is the default screen at `/pod/`. An **Admin Login** button in the header leads to staff login. If `maintenance_mode` is on, the kiosk shows a "Under Maintenance" card with `maintenance_message` (default text: "The check-in kiosk is temporarily unavailable. Please see the Discipline Office.") and nothing else; it fails **open** if the settings read errors.

On load the kiosk fetches all active categories (ordered by `sort_order`), all active sub-categories and all active keywords, once.

### 5.1 Step 1 — find the student

A search box, autofocused. Nothing happens under 2 characters. After a 300 ms pause it searches `students` by `name ILIKE %q%` or `student_no ILIKE %q%`, fetches up to 20, shows the first 8 as `name / level - section / student_no`. Tapping one selects the student and moves to the form. **Inactive students are not excluded** (§17).

### 5.2 Step 2 — the form

Header card: the student's name, number and `grade_section`, with a **Change** button that resets everything.

**Nature of Visit:** a grid of colour-coded buttons, one per active category, each with an icon and the name (colours in §12). Tapping selects it. Selecting anything other than Late resets `meridiem` to the current default.

Then, depending on the category:

- **Adviser** (if `requires_teacher`): auto-resolved (§5.3) and shown as `Last, First · email` with a green "✓ Adviser for Grade 9 - Obedience" note, and a **Change** button. If not resolved, a search box over active teachers by first or last name, ≥ 2 chars, 8 results.
- **Day(s) of Absence** (if the category is named `Absent`): see §5.4.
- **If Late** (if the category is named `Late`): two buttons **A.M.** / **P.M.**, defaulting to A.M. before noon, plus a live clock.
- **Reason / Explanation** (if `requires_reason`): a textarea. A counter shows "N more characters needed" until 10 characters, then "✓ Good". Once the trimmed reason is ≥ 5 characters the classifier runs on every keystroke and shows a **System Suggestion** box: `sub-category · status`, coloured by status, plus "📄 Will require: <document>" when the sub-category requires one.

Buttons: **← Back** (reset) and **Submit →**.

### 5.3 Adviser auto-resolution

When a student is selected: if they have a `section`, look for one active teacher with the same `level` **and** `section`; if none, fall back to the same `section` alone (some schools reuse section names across levels); take the first. If found, the adviser is set with the "auto" marker. The student can still change it.

### 5.4 Absence dates

Two native date inputs, **First day** and **Last day**, both capped at today. Picking the first day sets the last day to the same value if the last day is empty or earlier. The last day is disabled until a first day exists and cannot precede it.

Half days:

- Single day: a checkbox **Half day only**, and when ticked, **morning** / **afternoon** buttons (default morning).
- A range: **First day is a half day** with morning/afternoon (default morning), and **Last day is a half day** with morning/afternoon (default afternoon).

Under the inputs: "Pick the day you were absent — future dates aren't allowed." plus " Weekends aren't counted." when `count_weekends` is off, plus "**N days total.**" when N > 0.

### 5.5 Absence day counting (exact)

```
countedDays(first, last, includeWeekends):
    n = 0
    for each calendar day d from first to last inclusive:
        if includeWeekends or d is not Saturday/Sunday: n += 1
    return n

absenceDays(first, last, firstHalf, lastHalf, includeWeekends):
    whole = countedDays(...)
    if whole == 0: return 0            # e.g. a lone Sunday with weekends off
    single = (last is empty or last == first)
    halves = 0
    if firstHalf and counted(first): halves += 0.5
    if not single and lastHalf and counted(last): halves += 0.5
    return max(0.5, whole - halves)

absenceHalfNote:
    single: "morning" | "afternoon" if firstHalf, else null
    range:  join of "first day <which>" and/or "last day <which>", else null
```

`counted(day)` = includeWeekends or not a weekend. Display label: `Jul 17 – Jul 19, 2026 (2.5 days, first day afternoon)`; one day prints as `Jul 19, 2026 (1 day)`.

### 5.6 Validation and what is written

Validation, in order: a student is selected; a category is selected; an adviser if `requires_teacher`; for Absent: a first day exists, first day is not after today, last day is not after today, last day is not before first day; a reason of ≥ 10 trimmed characters if `requires_reason`. Errors show inline under the field.

On submit, one row is inserted with:

```
name, student_id (= student_no), grade_section, category_id,
teacher_id | null, teacher_name | null, teacher_email | null,
nature = [category name], reason (trimmed) | null,
meridiem = (Late ? chosen : null),
time_arrived = now "hh:mm AM", date = today "Mon D, YYYY",
absence_date, absence_end_date (= first day if no last day), absence_days, absence_half   (Absent only, else null),
ai_sub_category, ai_status, ai_explanation   (from the classifier, or null),
status = null,
document_required = suggestion.document_required or false,
document_status = required ? "Promised" : "Not Required",
document_deadline = required ? (today + document_deadline_days) as "Mon D, YYYY" : null,
notification_sent = false
```

The insert asks for no row back, because the anonymous role may insert but not read slips. On failure the form shows "Could not save. <error>" and stays put.

### 5.7 Constraints the database enforces on a public insert

A slip from the public role must arrive: `status`, `final_sub_category`, `confirmed_by`, `confirmed_at` all null; `notification_sent` false and `notification_sent_at` null; `reason` ≤ 500, `name` ≤ 120, `grade_section` ≤ 80, `student_id` ≤ 40, `teacher_email` ≤ 160 characters; `name` and `category_id` not null. There is no rate limiting.

**▶ Port.** Enforce the same in the PHP insert handler, and add: `student_notification_sent` false, `student_no` must exist and be active, `category_id` must be active, `absence_date` ≤ today, and per-IP plus per-student rate limits through ABC's `rate_limits`. The student search endpoint should return only `student_no, name, level, section` and never the whole roster.

### 5.8 Step 3 — preview slip

A card styled as the paper form: header "ATENEO DE ILOILO – SMCS / DISCIPLINE OFFICE / ADMISSION SLIP"; fields Name, Date, Time Arrived, Date(s) Absent (if any), Gr. & Sec., Adviser; NATURE badge plus meridiem; the reason in quotes; the **System Suggestion** box if any; a **Document Required** box with description and "Submit by: <deadline>" if any; the notice "Please see the **POD officer** for confirmation before proceeding to class."; a signature line "Prefect of Discipline / Discipline Officer". Buttons **🖨 Print Slip** (browser print of the print-isolated slip, §12.3) and **Done — Next Student** (reset).

---

## 6. Classifier

Runs in the browser only. Inputs: the reason text, the selected category name, all active keywords, all active sub-categories.

### 6.1 Vocabulary

Statuses, everywhere: `Excused`, `Unexcused`, `Admit Temporarily`. Document statuses: `Not Required`, `Promised`, `Received`.

### 6.2 Algorithm (exact)

```
r = lowercase(reason)
relevant = keywords where nature == categoryName or nature == "Any"
scores = {}                                   # sub_category_id -> {score, votes{status: weight}}
for k in relevant:
    if r contains lowercase(k.keyword):
        scores[k.sub_category_id].score += k.weight
        scores[k.sub_category_id].votes[k.suggested_status] += k.weight
if scores is empty:
    return {sub_category: null, status: "Admit Temporarily", confidence: "medium",
            explanation: "No matching keywords. POD officer review needed.",
            document_required: false}
best = sub-category with the highest score (ties: first encountered)
topStatus = status with the highest vote weight within best (ties: first encountered)
sub = active sub-category with id == best (may be missing → name null)
return {sub_category: sub.name, sub_category_id, status: topStatus,
        confidence: score >= 2 ? "high" : "medium",
        explanation: 'Matched keywords suggest "<name>" — <status>.',
        document_required: sub.document_required, document_description: sub.document_description,
        document_deadline_days: sub.document_deadline_days}
```

Substring matching, so `province` also fires inside `from province`; both add. Confidence is computed but never stored or shown.

**▶ Port.** Same algorithm in plain JavaScript on the kiosk page, keywords served by a public read endpoint. Optionally repeat it server-side on insert so `ai_*` can't be spoofed.

---

## 7. Dashboard (staff)

### 7.1 Shell

Header: seal, "POD Dashboard", tab buttons (Slips always; Categories, Directory, Users, Reports, Settings by permission; Roles for superadmin), the user's name and role, **Sign Out**. Under 640 px the header compacts and the list is forced to cards.

### 7.2 Working set and stat cards

The list loads **every pending slip** plus the **500 most recently filed confirmed slips**, newest first. Older confirmed slips are reachable through Reports; a muted note under the list says so when more exist.

Five stat cards, each a shortcut filter: **Today** (slips whose `date` equals today's label), **Pending** (`status` null), **Excused**, **Unexcused**, **Total**. Total, Pending, Excused and Unexcused are exact counts from the database; Today is counted from the loaded rows, which are complete for today. Counts refresh after every confirm or delete.

### 7.3 Filters

Status chips (All, Pending, Excused, Unexcused, Admit Temporarily); Nature chips built from the natures present in the loaded rows; Dept chips (All, PS/GS, JHS, SHS, computed per §11.1); a **⚑ Repeat offenders** toggle; free-text search on name or student number; **Table** / **Cards** toggle; refresh. Clicking a stat card clears the others as needed.

### 7.4 Repeat offenders

On load: read `repeat_offender_threshold` and `school_year_start_month`; compute the current school-year label (§11.2); query `student_category_counts` for rows in that year with `cnt ≥ threshold`, highest first; keep the first row per student. Flagged students show a red badge `⚑ 4 Late` beside their name in the list and cards. Failure to load flags is silent.

### 7.5 Table and cards

Table columns: Time, Date, Name (+ flag), Gr. & Sec., Nature (colour badge), Reason (truncated, italic), Suggested (`sub · status`), Status pill, and a **Confirm** (pending) or **Review** (confirmed) button. Cards show the same with a coloured left border: warning colour while pending, status colour after. Without `confirm_slips` the button is replaced by "—" / "View only".

### 7.6 Confirm modal

Header: name, number, section; **🖨 Print**; close. Summary block: Nature (+ meridiem), Time · Date, Date(s) Absent with the label from §5.5, an editable **Days** number input (step 0.5, prefilled with `absence_days` or the inclusive calendar count), Adviser, Reason. Then the **System Suggestion** box if any.

Fields:

- **Nature of Visit** (only with `manage_slips`): a select of active categories. Changing it clears the sub-category and shows "Changing from "Late" — the sub-category has been cleared, pick a new one below."
- **Sub-category**: a select of active sub-categories of the current category, prefilled with `final_sub_category` or `ai_sub_category`. A legacy value not in the active list is kept as the first option. If the category has no sub-categories, a free-text input instead.
- **Final Status**: three buttons.
- **Document Status** (only if `document_required`): shows "📄 Required: <description> (by <deadline>)" and **Promised** / **Received** buttons.
- A notice block describing what confirming will do for each recipient: already notified (with timestamp), emails off in Settings, "Confirming will email <adviser> at <email>", "No adviser email on file", "Confirming will email the student a copy, if an address is on their record".

Validation: a sub-category is required when the category has any; a status is required.

Patch written on **Confirm Slip** / **Update Slip**:

```
final_sub_category, status, document_status,
confirmed_by = staff full_name or email, confirmed_at = now, updated_at = now,
absence_days = the Days input       (absence slips only, if non-empty),
category_id + nature = [new name]   (only with manage_slips and only if changed)
```

Then, if either recipient could still be due (adviser: emails on, `teacher_email` present, `notification_sent` false; student: student emails on, `student_notification_sent` false), the notification function is called once (§8). If it reports success the modal closes and the row's sent flags update from the response. If it fails, the slip **stays confirmed** and the modal shows "✅ Slip confirmed — but the adviser email didn't go through: <error>. It's been logged. Re-open this slip and confirm again to retry." with a **Close** button. Re-confirming a slip later retries whichever recipient is still unsent.

**Delete** (only with `manage_slips`): a small red link "Delete this slip permanently" expands to a confirmation naming the slip and warning that it and its email history go for good and it disappears from past reports; **Keep it** / **Delete permanently**. The delete asks for the deleted row back, and treats an empty answer as failure, because a delete blocked by policy otherwise looks like success.

**▶ Port.** Write an ABC `audit` row for confirm, correction and delete. Consider a soft delete (`deleted_at`) instead of a hard one.

---

## 8. Notifications

### 8.1 Trigger

Called by the confirm modal after a successful save, whenever at least one recipient might be due. The function re-checks everything itself; the client's check only avoids a pointless call.

### 8.2 Authorisation

The caller must present a valid staff session whose profile is active and whose role is `pod_staff`, `pod_admin` or `superadmin`. Anything else is refused. (This is a role list, not the matrix; see §17.)

### 8.3 Recipients and skip rules

Both switches are read together; a missing key counts as on.

- **Adviser:** skipped if `notification_sent` is already true, or adviser emails are off, or the slip has no `teacher_email`. Address: **`teacher_email` from the slip** (§17).
- **Student:** skipped if `student_notification_sent` is already true, or student emails are off, or no address. Address: **`students.email` looked up by `student_no` at send time**, never from the slip, because the kiosk writes slips anonymously and an address carried on the slip could be forged.

Each recipient is independent: one failing does not stop the other. After a successful send the matching `*_sent` and `*_sent_at` columns are set. Response: `{ok:true, sent:[...], reason?}` or, if any failed, HTTP 500 with `{ok:false, error:"adviser: ...; student: ...", sent:[...]}`.

### 8.4 Logging

Per recipient: insert `notification_log` `(slip_id, channel='email', recipient_email, subject, status='pending', attempts=1)`; on success update `status='sent', sent_at`; on failure `status='failed', error_message`.

### 8.5 The email

From `Ateneo de Iloilo Discipline Office <pod@adi.edu.ph>`. CR/LF are stripped from the To and Subject headers. All slip values are HTML-escaped.

Subject: `Admission Slip #<id> · <name> · <natures> — <status or Pending>`

Body, a 560 px table with inline styles (Outlook-safe):

1. Navy header with the school seal (loaded from `https://adi.edu.ph/pod/seal.png`), "Ateneo de Iloilo – SMCS", "Discipline Office · Official Notice".
2. "ADMISSION SLIP · REF #<id>", then "Notice of <natures>".
3. Lead paragraph. Adviser: "This is to inform you that the student named below, from your advisory class, reported to the Discipline Office. The matter has been reviewed and given the following disposition:". Student: "This is to formally acknowledge that you reported to the Discipline Office on the date indicated below, and that the matter has been reviewed and given the following disposition:".
4. Status pill, coloured green / red / orange for Excused / Unexcused / Admit Temporarily, grey otherwise.
5. Rows: Student (bold), Student no., Grade & section, Nature of visit (+ meridiem), Date filed, Time, Days covered (`first – last (N days, half note)`, absences only), Classification (`final_sub_category`, if set), Reason given (italic, quoted), Confirmed by.
6. If `document_required`: an orange box "Document required / <description or 'A supporting document'> / Please submit on or before **<deadline>**."
7. Closing: "Issued by the Office of the Prefect of Discipline / Ateneo de Iloilo – Santa Maria Catholic School".
8. Footer: "This serves as your electronic copy. Retain for your records. Automated message — please do not reply."

### 8.6 Transport today

Gmail API, service account with domain-wide delegation, impersonating `pod@adi.edu.ph`. **Broken in production** (`invalid_grant`); no email has ever been delivered. Every other part of the pipeline has been verified.

**▶ Port.** Queue into ABC `mail_queue` and let `mail_drain.php` send over SMTP with an app password, which is known to work. Sending as `pod@adi.edu.ph` needs either a second SMTP block or a send-as alias on the ABC account. Resolve the adviser address from ABC `users` / `sections.adviser_email` at send time, not from the slip.

---

## 9. Admin screens

### 9.1 Categories (`manage_categories`)

A three-level accordion: category → sub-categories → keywords, with **+ New Category**, **+ Add sub-category**, **+ Add keyword**, **Edit**, **Deactivate / Activate**, and for keywords **Delete** (with a browser confirm).

- Category modal: name (required), description, requires reason, requires adviser, has sub-categories, active, sort order (auto = max + 1 when left 0).
- Sub-category modal: name (required), suggested status, requires a supporting document (then description and deadline days), active, sort order (auto).
- Keyword modal: keyword (required, stored lowercase), applies to (this category or Any), weight (≥ 1, default 1), suggested status, active. The help text: "The classifier matches when a student's reason *contains* this text (case-insensitive). Higher weight = stronger pull toward this sub-category."

Categories and sub-categories are never deleted, only deactivated, so historical slips stay intact. Inactive rows show dimmed with an "Inactive" badge. Sub-categories with no keywords show "No keywords — the classifier can't auto-suggest this sub-category."

### 9.2 Directory (`manage_directory`)

Two tabs, **Advisers** and **Students**, each with search (debounced 350 ms), paging of 25 with a `N advisers · page x of y` footer, refresh, **Import CSV**, **+ New**, and per-row **Edit** and **Deactivate / Activate**.

**Adviser modal:** last, first, middle name, employee ID, email, an **Advisory class** select populated from `student_sections` (with "— None (adviser won't be auto-assigned) —" and, if the current value matches no student section, a "(no students)" entry so it is not silently lost), department, active. First and last name required; an email must contain `@`.

**Adviser CSV import.** Header names are squashed (lowercase, non-alphanumerics removed) and matched against aliases:

| Field | Accepted headers |
|---|---|
| employee_id | employeeid, empid, employeeno, idno, id |
| last_name | lastname, surname, familyname |
| first_name | firstname, givenname |
| middle_name | middlename, middleinitial, mi |
| name | name, fullname, teachername, advisername |
| email | email, emailaddress, schoolemail |
| department | department, dept |
| level | level, grade, gradelevel, yearlevel |
| section | section, advisoryclass, advisory, class |

A single `name` column is split on the comma (`DELA CRUZ, JUAN P.` → last / first) or, without a comma, on the last space. Rows without a last name are dropped. Match existing advisers on employee ID first, then email; matched rows are **updated** with the imported columns, the rest are **inserted** active. Nothing is deleted. Sections that match no enrolled students are listed as a warning before import. Progress is reported per update and per 100 inserts.

**Student modal:** student no. (required), RFID, full name (required), email, grade level, section, gender, program, enrolled/active.

**Student CSV import.** Aliases: student_no (studentno, studentnumber, studentid, idno, lrn), name (name, studentname, fullname), level, section (section, class), gender (gender, sex), program (program, strand, track), rfid (rfid, rfidtag, cardno), email (email, emailaddress, schoolemail, studentemail). Only `student_no` is mandatory. Rows are **upserted on `student_no`** in chunks of 200. `is_active` is set true only when the file has a name column (a full roster asserts who is enrolled); a partial file such as number + email leaves it alone so it cannot resurrect former students.

**▶ Port.** Both tabs go away; ABC owns the roster. Keep only a POD-specific "student email" editor if ABC does not grow one.

### 9.3 Users (`manage_users`)

Table: name (with "(you)"), email, role label (Super Admin / Admin / Staff / Faculty), status (Active / Inactive, plus "temp pw" while `must_change_password`), actions **Edit**, **Deactivate / Activate**, **Reset PW** — only for users the caller outranks, never for self.

- **Create:** full name, school email (must end `@adi.edu.ph`), role (only Admin / Staff, and only below the caller's rank), temporary password ≥ 8. The account is created confirmed, with `must_change_password = true`. Notice: "Share the temp password — they'll be asked to change it on first login."
- **Edit:** full name and role (same rank rules).
- **Reset PW:** sets a new temporary password and `must_change_password = true`.

The server-side function additionally requires the caller's rank ≥ admin **and** (for non-superadmin) a `manage_users` grant, and never creates a superadmin. On a profile write failure after account creation it deletes the auth user so nothing is orphaned.

**▶ Port.** ABC's Users page and set-password invite flow. Add the `@adi.edu.ph` rule.

### 9.4 Roles (superadmin)

A grid of the seven capabilities × Admin / Staff / Faculty, with Super Admin shown locked. Each cell toggles a `role_permissions` row immediately. Footer: "Changes take effect the next time a user signs in."

### 9.5 Settings (`manage_settings`)

Repeat-offender threshold (integer ≥ 1, Save button), school-year start month (select, saves on change), student email notifications (toggle), count weekends in absences (toggle), adviser email notifications (toggle), maintenance mode (toggle) with the kiosk message textarea and **Save message**. Saving the threshold or start month re-runs repeat-offender flagging on the dashboard.

---

## 10. Reports (`view_reports`)

### 10.1 Window and loading

Period: **Daily** (today), **Weekly** (Monday of this week to today), **Monthly** (1st to today), **Custom** (from/to, to ≤ today). Slips are fetched by `created_at` between window-start minus 2 days and window-end plus 2 days (up to 20,000 rows), then filtered client-side by the day parsed from the **`date` label** so that days match what the POD sees. The heading shows "Counts use each slip's filing date."

### 10.2 Summary

Break down by **Category** (each element of `nature`, or `(uncategorised)`), **Department**, **Grade Level**, or **Section**. Columns: Excused, Unexcused, Admit Temp., Pending, Total, with a TOTAL row. Sorted by total descending, except Department in the fixed order PS/GS, JHS, SHS. **Export CSV**: title row `ADI-SMCS Discipline Office — <Daily|Weekly|Monthly|Custom> report by <group>`, the range, a blank, header, rows, TOTAL.

### 10.3 Monitoring Sheet

The POD's paper format. Scope: All, Department, Grade Level, or Section (the last two offer the values present in the window). Rows sorted by section then name.

Columns: NAME OF STUDENT, YEAR & SECTION, DATE FILED, DAYS COVERED, ABSENCES, TARDINESS, TIME, UNIFORM, STATUS, REASONS, then six reason columns under a **lateness** band and the same six under an **absences** band: `health`, `traffic`, `OSR`, `travel`, `woke up late`, `fam matters`.

Per slip:

- reason key = first match on the lowercase sub-category (`final_sub_category`, else `ai_sub_category`): contains `health` → health; `traffic`; `osr`; `travel`; `woke` → woke up late; `fam` → fam matters; else none.
- DAYS COVERED: the absence range plus `(half note)`, absences only.
- ABSENCES: `absence_days` if set, else the inclusive calendar count, else `✓`; only when the nature includes Absent.
- TARDINESS: `✓` when Late. TIME: `time_arrived meridiem` when Late, else `time_arrived`. UNIFORM: `✓` when Uniform.
- REASONS: the reason text, else the sub-category.
- Lateness band: a mark under the reason key when Late; absences band: the same when Absent.

Preview shows the first 60 rows. **CSV**: three title rows (`ATENEO DE ILOILO – SMCS · DISCIPLINE OFFICE`, `Admission Slip Monitoring Sheet`, `<scope> · <range>`), a blank, the band row (ten blanks, `lateness`, five blanks, `absences`, five blanks), the header, the rows; marks are `1`. **Excel (tabs per section)**: one worksheet per section in the scope, same layout, title rows merged across all 22 columns, the two band cells merged over their six columns, column widths 28/18/11/18/9/9/10/8/12/24 then 6 × 12, marks as numbers so they can be summed. Sheet names are cut to 31 characters, stripped of `[ ] : * ? / \`, and de-duplicated with ` (2)`.

### 10.4 Export safety

Every text cell that begins with `=`, `+`, `-`, `@`, tab or CR is prefixed with `'` so a student-typed reason can never execute as a formula. CSV text is folded to ASCII (`–`, `—`, `·`, `•` → `-`; `✓` → `1`; curly quotes → straight), written with a UTF-8 BOM, CRLF line ends, and RFC-4180 quoting. Numbers stay numeric.

**▶ Port.** SQL replaces the client-side buckets; generate the workbook with PhpSpreadsheet or keep SheetJS in the browser. Keep every rule in 10.3 and 10.4.

---

## 11. Derivations

### 11.1 Department from a section label

`level` = the part of `grade_section` before ` - `. Then: a number ≥ 11 → **SHS**; ≥ 7 → **JHS**; ≥ 1 → **PS/GS**; no number but the level contains kinder, prep, nursery, casa, toddler or pre-school → **PS/GS**; otherwise **Unassigned**. ABC's `grade_band()` uses the same cut-offs with the label `GS`.

### 11.2 School year

Given `start_month` (default 6): a timestamp whose month ≥ start_month belongs to `YYYY-(YYYY+1)`, otherwise `(YYYY-1)-YYYY`. The database function takes a plain `timestamp`, matching the UTC `created_at` column, so a slip filed after 4 p.m. Manila on the last day of May lands in the next school year by this rule (§17).

---

## 12. Presentation reference

### 12.1 Brand and status colours

Navy `#12315B` (chrome, primary buttons), gold `#C8A24B` (accents), link blue `#1F5FA9`. Text `#1D1D1F`, muted `#6E6E73`, light `#86868B`; surfaces white on `#F5F5F7`; borders `#E5E5E7` / `#D2D2D7`. Statuses: Excused `#248A3D`, Unexcused `#D70015`, Admit Temporarily `#B25000`. Body 17 px system font, 8 px spacing grid, 8 px radii, 44 px minimum touch targets on touch devices.

### 12.2 Category colours and icons

Matched on a lowercase substring of the category name: late `#B25000` ⏰ · absent `#1565C0` 📅 · uniform `#00695C` 👔 · hair `#6A1B9A` ✂️ · gadget `#3949AB` 📱 · post `#5D4037` 📋 · suspen `#C62828` ⛔ · other `#455A64` ❓. Unknown names get a stable colour from a hash over a ten-colour palette. Kiosk buttons are filled when selected, tinted (8 % alpha) when not.

### 12.3 Printable slip

A hidden block `#printable-slip` revealed only under `@media print`, which hides everything else. Rows: Name, Student ID, Gr. & Sec., Date, Time Arrived, Date(s) Absent (if any), Adviser, Nature (+ meridiem), Reason, Category (sub-category), Status (or "Pending — for POD confirmation"), Document (`<status> — by <deadline>`, if required), Confirmed by; then a signature line. The kiosk prints it with the suggested values and no confirmer; the dashboard prints it with the modal's current values.

---

## 13. Authentication and session

- Login form: email must end `@adi.edu.ph` (client rule; accounts can only be created with that domain anyway), password. Errors are generic ("Invalid email or password").
- A deactivated account is signed out immediately on load with "Your account has been deactivated. Please contact an administrator."
- `must_change_password` forces a **Set a New Password** screen (≥ 8 characters, confirm) before anything else; success clears the flag through `clear_my_password_flag()`.
- **Inactivity logout** after 30 minutes without mouse, key, touch or scroll activity.
- Sessions persist in the browser and refresh automatically.

**▶ Port.** ABC's login, `must_set_password` flow, and PHP session with the same Secure / HttpOnly / SameSite cookies. Add the 30-minute idle logout (server-side session timeout plus a client timer).

---

## 14. Security invariants to preserve

1. The public kiosk can insert an unreviewed, un-notified slip with bounded field lengths and nothing else (§5.7).
2. The student's email address is read from the roster at send time, never trusted from the slip. The port must do the same for the adviser.
3. Sending mail and managing accounts happen only in server code that authenticates the caller itself; secrets never reach the browser.
4. Every slip value in an email is HTML-escaped; header fields are stripped of CR/LF.
5. Spreadsheet exports neutralise formula injection.
6. The permission matrix, not the UI, decides what a role may do.
7. Only superadmin edits the matrix; a user never acts on their own account in user management.

Accepted today and to be fixed in the port: no rate limiting on the kiosk; the whole roster is readable with the public key.

---

## 15. Time and date conventions

Today: `created_at` is UTC in a timezone-less column; `date` and `document_deadline` are en-US text labels stamped from the browser's clock; `absence_date` is a real date; `confirmed_at` and the `*_sent_at` columns are UTC timestamps from the browser. Reports bucket by the label, repeat-offender years by the UTC timestamp.

**▶ Port.** Follow ABC: Manila local time everywhere, `DATE` and `DATETIME` columns, no text labels. Format for display at render time.

---

## 16. Operating notes carried over

- Categories and keywords are cached by the kiosk page on load; changes apply on the next reload.
- Confirming sends mail; re-opening a confirmed slip and confirming again retries any recipient still marked unsent.
- The POD can override the computed absence day count per slip; the override is what reports use.
- Six lateness reasons on the paper form (Health, Traffic, OSR, Travel, Woke Up Late, Family Matters) map to the first six `Late` sub-categories; the Monitoring Sheet tallies them by name substring.

---

## 17. Known issues — fix in the port, do not carry over

1. **Dashboard truncation.** Fixed on 2026-09-16 (working set = all pending + 500 newest confirmed). Any rebuild should paginate server-side from the start.
2. **Inactive students appear in the kiosk search** and in `student_sections`. Filter on active.
3. **`document_description` is never written by the kiosk**, so the confirm modal and the email fall back to blank / "A supporting document". Snapshot it from the sub-category at filing time.
4. **The adviser email is trusted from the slip.** Resolve it from the roster at send time (§8.3).
5. **Two function checks disagree with the matrix.** User management requires rank ≥ admin regardless of a `manage_users` grant; notifications require a fixed role list regardless of `confirm_slips`. Make both consult the matrix.
6. **Behaviour keyed on category names** (`Absent`, `Late`) and keyword `nature` matched on names. Use ids and flags (§4.3, §4.5).
7. **`student_notification_sent` is not constrained on public insert.** Constrain it.
8. **School-year boundary uses a UTC timestamp**, so late-afternoon slips on the boundary day land in the wrong year. Use the local filing date.
9. **`nature` is an array holding one value.** Use a single category id plus a name snapshot.
10. **The base schema is not in the repo.** The port's `db/migrations/` file must be complete.
11. **Faculty role** exists in the ladder but is unassignable and unused. Decide whether advisers get a read-only view (recommended) or drop it.

---

## 18. Data migration from Supabase to MariaDB

Export every table from the Supabase dashboard (CSV) or `pg_dump`. Then, per table:

| Source | Target | Transform |
|---|---|---|
| `students` | ABC `students.email`, `active` | Match on `student_no`. Copy `email` (ABC has none). Do **not** overwrite names or sections; ABC's roster is master. Report numbers present in POD but missing in ABC |
| `teachers` | ABC `users` (role `adviser`), `sections.adviser_email` | Match on lowercase email. Where POD has `level + section`, set ABC `sections.adviser_email` if empty. Report advisers with no ABC user |
| `profiles` | ABC `users` | Match on email; create missing with `must_set_password = 1` and the mapped role (§2). Passwords are not carried over; invite via ABC |
| `categories`, `sub_categories`, `keywords` | `pod_categories`, `pod_sub_categories`, `pod_keywords` | Keep ids. Set `asks_absence_dates` for Absent, `asks_meridiem` for Late. Map keyword `nature` name → `category_id`, `Any` → null |
| `role_permissions` | `pod_role_perms` | Map role names per §2 |
| `settings` | ABC `settings` with `pod_` prefix | JSON values to strings |
| `admission_slips` | `pod_slips` | `filed_at` = `created_at` + 8 h; `filed_date` = parse the `date` label (fallback: `filed_at` date); `document_deadline` = parse the label; `category_id` as is, `category_name` = `nature[0]`; `student_no` = `student_id`; `section_id` = look up ABC section by label = `grade_section`, else null and keep the label snapshot; `adviser_user_id` = ABC user by `teacher_email`, else null; `confirmed_at`, `*_sent_at` + 8 h; all other columns one to one |
| `notification_log` | `pod_notification_archive` | Optional. Keep for history; nothing reads it |

Validate: row counts per table; every slip's `student_no` exists in ABC; count of slips whose section did not resolve; count of slips whose adviser did not resolve; spot-check ten slips end to end including one half-day absence and one with a document.

Cut-over: switch the old kiosk to maintenance mode, run the final delta on `admission_slips` (rows with `id` greater than the last migrated), flip the module flag to everyone, point `/pod/` at the new pages, keep Supabase read-only for a month.

---

## 19. Glossary

**POD** — Prefect of Discipline, the Discipline Office. **Slip** — one admission-slip record. **Nature of Visit** — the top-level category. **Sub-category** — the classified reason within a category. **Admit Temporarily** — provisional status pending a document or decision. **OSR** — a paper-form lateness reason whose meaning is unconfirmed. **PS/GS · JHS · SHS** — pre-school/grade school, junior high, senior high. **Repeat offender** — a student at or above the threshold in one category within the school year. **Monitoring Sheet** — the POD's per-section paper log that Reports reproduces.
