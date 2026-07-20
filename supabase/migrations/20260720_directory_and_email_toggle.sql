-- Directory management (advisers + students) and an admin switch for emails.
--
-- 1. Advisers gain level/section so the kiosk can resolve a student's adviser
--    automatically instead of asking the student to pick a name.
-- 2. A new `manage_directory` capability gates student/adviser editing.
-- 3. email_notifications_enabled lets an admin pause adviser emails.

-- ── Adviser level + section ───────────────────────────────────────
alter table teachers add column if not exists level text;
alter table teachers add column if not exists section text;
create index if not exists teachers_level_section_idx on teachers (level, section);

-- ── New capability: manage_directory ──────────────────────────────
insert into role_permissions (role, permission)
values ('pod_admin', 'manage_directory')
on conflict do nothing;

-- my_permissions() lists every capability so superadmin implicitly holds them all.
create or replace function public.my_permissions()
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  select p from (
    select unnest(array[
      'confirm_slips', 'manage_categories', 'manage_users',
      'manage_settings', 'manage_directory', 'view_reports'
    ]) as p
    where get_my_role()::text = 'superadmin'
    union
    select permission from role_permissions where role::text = get_my_role()::text
  ) t;
$$;
revoke all on function public.my_permissions() from public;
grant execute on function public.my_permissions() to authenticated;

-- ── Directory write access (reads stay public for the kiosk) ──────
grant insert, update, delete on teachers to authenticated;
drop policy if exists teachers_admin_write on teachers;
create policy teachers_admin_write on teachers
  for all to authenticated
  using (has_perm('manage_directory')) with check (has_perm('manage_directory'));

grant insert, update, delete on students to authenticated;
drop policy if exists students_admin_write on students;
create policy students_admin_write on students
  for all to authenticated
  using (has_perm('manage_directory')) with check (has_perm('manage_directory'));

grant usage, select on all sequences in schema public to authenticated;

-- ── Student CSV import needs a unique key to upsert on ────────────
-- student_no should already be unique from the original import; this is a
-- no-op when a unique index/constraint on that column already exists.
do $$
begin
  if not exists (
    select 1 from pg_indexes
    where tablename = 'students' and indexdef ilike '%unique%(student_no)%'
  ) then
    execute 'create unique index students_student_no_uniq on students (student_no)';
  end if;
end $$;

-- ── Adviser email on/off ──────────────────────────────────────────
insert into settings (key, value)
values ('email_notifications_enabled', 'true'::jsonb)
on conflict (key) do nothing;
