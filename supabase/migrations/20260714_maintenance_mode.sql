-- Phase 5: maintenance mode. The kiosk runs as anon and reads maintenance_mode /
-- maintenance_message to show a "closed" screen; staff can still log in normally.
-- Only these two keys are exposed to anon (the threshold etc. stay staff-only).

insert into settings (key, value) values
  ('maintenance_mode', 'false'::jsonb),
  ('maintenance_message', '"The check-in kiosk is temporarily unavailable for maintenance. Please see the Discipline Office."'::jsonb)
on conflict (key) do nothing;

grant select on settings to anon;

drop policy if exists settings_public_read on settings;
create policy settings_public_read on settings
  for select to anon
  using (key in ('maintenance_mode', 'maintenance_message'));
