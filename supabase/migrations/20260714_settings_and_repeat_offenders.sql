-- Phase 5: admin-configurable settings + repeat-offender detection.
--
-- settings: a simple key/value config store (first use: repeat_offender_threshold,
-- default 3). Readable by any staff; writable only by admins. Also the home for
-- future toggles (maintenance mode, etc.).
--
-- student_category_counts: per-student, per-category slip totals. A student is a
-- "repeat offender" when any single category's count reaches the threshold.
-- security_invoker so it runs under the caller's RLS (staff already see all slips).

create table if not exists settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);

alter table settings enable row level security;

drop policy if exists settings_read on settings;
create policy settings_read on settings
  for select to authenticated using (true);

drop policy if exists settings_admin_write on settings;
create policy settings_admin_write on settings
  for all to authenticated
  using (get_my_role() in ('pod_admin', 'superadmin'))
  with check (get_my_role() in ('pod_admin', 'superadmin'));

grant select, insert, update, delete on settings to authenticated;

insert into settings (key, value)
values ('repeat_offender_threshold', '3'::jsonb)
on conflict (key) do nothing;

create or replace view student_category_counts
  with (security_invoker = true) as
select
  s.student_id,
  max(s.name)     as name,
  n.nature        as category,
  count(*)::int   as cnt
from admission_slips s
cross join lateral unnest(s.nature) as n(nature)
where s.student_id is not null
group by s.student_id, n.nature;

grant select on student_category_counts to authenticated;
