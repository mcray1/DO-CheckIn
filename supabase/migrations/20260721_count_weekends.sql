-- Whether Saturdays/Sundays count toward an absence day total. Default false —
-- weekends are not counted. The kiosk reads this to compute the default day
-- count; the POD can still override the number per slip when confirming.
insert into settings (key, value)
values ('count_weekends', 'false'::jsonb)
on conflict (key) do nothing;

-- The kiosk runs as anon, so expose this key (alongside the maintenance keys)
-- to anon reads. Recreate the public-read policy with the extra key.
drop policy if exists settings_public_read on settings;
create policy settings_public_read on settings
  for select to anon
  using (key in ('maintenance_mode', 'maintenance_message', 'count_weekends'));
