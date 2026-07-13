-- Phase 3 — Notification Engine
-- Records every teacher-notification attempt (email only for now).
-- The notify-teacher Edge Function writes here with the service role, which
-- bypasses RLS; the SELECT policy simply lets logged-in POD read the history.

create table if not exists notification_log (
  id bigint generated always as identity primary key,
  slip_id bigint references admission_slips(id) on delete cascade,
  channel text default 'email',
  sender_email text,
  recipient_email text,
  status text,                       -- sent | failed | skipped
  error_message text,
  created_at timestamptz default now()
);

alter table notification_log enable row level security;

drop policy if exists "POD read notification log" on notification_log;
create policy "POD read notification log" on notification_log
  for select to authenticated using (true);
