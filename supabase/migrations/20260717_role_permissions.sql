-- Permission matrix over the fixed roles. A (role, permission) row = granted.
-- superadmin is treated as all-permissions in has_perm() no matter what, and only
-- superadmin can edit this table, so nobody can lock themselves out. Defaults are
-- seeded to match the pre-existing behavior, so applying this changes nothing until
-- a superadmin toggles something.

create table if not exists role_permissions (
  role user_role not null,
  permission text not null,
  primary key (role, permission)
);

alter table role_permissions enable row level security;

-- Any signed-in user may read the matrix (the app gates its own UI from it).
drop policy if exists role_permissions_read on role_permissions;
create policy role_permissions_read on role_permissions
  for select to authenticated using (true);

-- Only superadmin may change it.
drop policy if exists role_permissions_superadmin_write on role_permissions;
create policy role_permissions_superadmin_write on role_permissions
  for all to authenticated
  using (get_my_role()::text = 'superadmin')
  with check (get_my_role()::text = 'superadmin');

grant select, insert, update, delete on role_permissions to authenticated;

-- Seed defaults = current behavior (superadmin is implicit-all, so not listed).
insert into role_permissions (role, permission) values
  ('pod_admin', 'confirm_slips'),
  ('pod_admin', 'manage_categories'),
  ('pod_admin', 'manage_users'),
  ('pod_admin', 'manage_settings'),
  ('pod_admin', 'view_reports'),
  ('pod_staff', 'confirm_slips')
on conflict do nothing;

-- has_perm(perm): superadmin implicitly has everything; otherwise look it up.
-- security definer + get_my_role() (also definer) avoids the profiles-recursion trap.
create or replace function public.has_perm(perm text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select get_my_role()::text = 'superadmin'
      or exists (
        select 1 from role_permissions
        where role::text = get_my_role()::text and permission = perm
      );
$$;
revoke all on function public.has_perm(text) from public;
grant execute on function public.has_perm(text) to authenticated;

-- my_permissions(): the caller's effective permissions (superadmin = the full set).
-- The frontend calls this once to decide which tabs/actions to show.
create or replace function public.my_permissions()
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  select p from (
    select unnest(array[
      'confirm_slips', 'manage_categories', 'manage_users', 'manage_settings', 'view_reports'
    ]) as p
    where get_my_role()::text = 'superadmin'
    union
    select permission from role_permissions where role::text = get_my_role()::text
  ) t;
$$;
revoke all on function public.my_permissions() from public;
grant execute on function public.my_permissions() to authenticated;

-- Rewire the config-write policies to consult the matrix (defaults keep admins working).
drop policy if exists categories_admin_write on categories;
create policy categories_admin_write on categories
  for all to authenticated
  using (has_perm('manage_categories')) with check (has_perm('manage_categories'));

drop policy if exists sub_categories_admin_write on sub_categories;
create policy sub_categories_admin_write on sub_categories
  for all to authenticated
  using (has_perm('manage_categories')) with check (has_perm('manage_categories'));

drop policy if exists keywords_admin_write on keywords;
create policy keywords_admin_write on keywords
  for all to authenticated
  using (has_perm('manage_categories')) with check (has_perm('manage_categories'));

drop policy if exists settings_admin_write on settings;
create policy settings_admin_write on settings
  for all to authenticated
  using (has_perm('manage_settings')) with check (has_perm('manage_settings'));

-- Slip confirmation. NOTE: this assumes the update policy is named `pod_update`
-- (per the project notes). If yours differs, drop that one too, or matching this.
drop policy if exists pod_update on admission_slips;
create policy pod_update on admission_slips
  for update to authenticated
  using (has_perm('confirm_slips')) with check (has_perm('confirm_slips'));
