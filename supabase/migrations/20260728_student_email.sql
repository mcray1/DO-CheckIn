-- Notify the student directly, in addition to their adviser.
--
-- The address lives on the students table (not on the slip) so it is always
-- read from trusted data at send time. The kiosk runs as anon and can write
-- slip columns, so an address copied onto the slip could be forged; looking it
-- up server-side by student number removes that path entirely.

alter table students
  add column if not exists email text;

comment on column students.email is
  'Student school email. Blank for pupils without an account — those slips simply skip the student notification.';

-- Tracked separately from notification_sent (the adviser flag) so each
-- recipient is guarded independently and neither can double-send.
alter table admission_slips
  add column if not exists student_notification_sent boolean not null default false;

alter table admission_slips
  add column if not exists student_notification_sent_at timestamptz;

-- Its own switch, independent of the adviser toggle.
insert into settings (key, value)
values ('student_email_notifications_enabled', 'true'::jsonb)
on conflict (key) do nothing;
