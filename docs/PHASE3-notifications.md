# Phase 3 — Teacher Email Notifications

When a POD officer confirms an admission slip, the app emails the teacher
**from the confirming officer's own mailbox** via the Microsoft Graph API.
Teams messaging is deferred — email only for now.

Pieces:
- `supabase/functions/notify-teacher/index.ts` — the Edge Function that sends the email
- `supabase/migrations/20260713_notification_log.sql` — the delivery log table
- Dashboard confirm flow — calls the function after a slip is saved (non-blocking)

---

## Step 1 — Register the Azure AD app (you do this in the Azure portal)

1. Go to <https://portal.azure.com> → **Microsoft Entra ID** (formerly Azure AD).
2. Left menu → **App registrations** → **+ New registration**.
   - **Name:** `DO CheckIn Notifications`
   - **Supported account types:** *Accounts in this organizational directory only (Single tenant)*
   - **Redirect URI:** leave blank
   - Click **Register**.
3. On the app's **Overview** page, copy these two values:
   - **Application (client) ID**  → this is `GRAPH_CLIENT_ID`
   - **Directory (tenant) ID**    → this is `GRAPH_TENANT_ID`
4. Left menu → **Certificates & secrets** → **+ New client secret**.
   - Description: `edge-function`, Expiry: 24 months → **Add**.
   - **Copy the secret _Value_ immediately** (not the Secret ID) → this is `GRAPH_CLIENT_SECRET`.
     You cannot see it again after leaving the page.
5. Left menu → **API permissions** → **+ Add a permission** → **Microsoft Graph**
   → **Application permissions** → search **Mail.Send** → check it → **Add permissions**.
6. Click **✓ Grant admin consent for <your org>** and confirm. The Mail.Send row
   must show a green "Granted" state.

> Security note: `Mail.Send` (application) lets the app send as **any** mailbox in
> the tenant. If you want to restrict it to only POD officer accounts, an Exchange
> admin can apply an **Application Access Policy** scoped to a mail-enabled security
> group. Optional, but recommended for production.

---

## Step 2 — Create the notification log table (Supabase → SQL Editor)

Paste and run the contents of `supabase/migrations/20260713_notification_log.sql`.

---

## Step 3 — Deploy the Edge Function (Supabase Dashboard)

1. Supabase → **Edge Functions** → **Deploy a new function** (or **Create function**).
2. Name it exactly **`notify-teacher`**.
3. Paste the full contents of `supabase/functions/notify-teacher/index.ts` into the
   editor and **Deploy**.

(If you prefer the CLI instead: `supabase functions deploy notify-teacher`.)

---

## Step 4 — Add the secrets (Supabase → Edge Functions → Secrets/Manage secrets)

Add three secrets with the values from Step 1:

| Name                  | Value                                  |
| --------------------- | -------------------------------------- |
| `GRAPH_TENANT_ID`     | Directory (tenant) ID                  |
| `GRAPH_CLIENT_ID`     | Application (client) ID                |
| `GRAPH_CLIENT_SECRET` | The client secret **Value**            |

`SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY` are provided automatically — do not add them.

---

## Step 5 — Test

1. Open the kiosk, submit a slip that selects a **teacher who has an email** on file.
2. Log in as POD, open that slip, set a status, click **Confirm**.
3. A green banner should read *"Teacher notified by email (…)"*.
4. Check the teacher's inbox, and confirm a `sent` row in `notification_log`:
   ```sql
   select slip_id, sender_email, recipient_email, status, error_message, created_at
   from notification_log order by created_at desc limit 10;
   ```

### If it fails
The banner shows the reason and a `failed` row is logged. Common causes:
- **`Email service not configured`** — secrets missing/misspelled (Step 4).
- **`Could not authenticate with Microsoft Graph`** — wrong tenant/client/secret,
  or the secret expired.
- **Send `403`** — admin consent not granted, or an Application Access Policy is
  blocking the sender (Step 1.6 / security note).
- **`email skipped`** — the slip has no `teacher_email`; the officer picked no
  teacher, or that teacher row has a blank email.

The slip is always saved regardless — a notification failure never blocks confirmation.
