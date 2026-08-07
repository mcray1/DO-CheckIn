-- `manage_slips`: correct or remove a filed slip.
--
-- Distinct from confirm_slips (status / sub-category / documents), which any POD
-- staff member does routinely. This covers the heavier corrections — changing
-- the Nature of Visit when a student tapped the wrong button, and deleting a
-- slip outright — so it can be granted to admins without also handing every
-- staff account the ability to rewrite or destroy records.
--
-- Supersedes the superadmin-only delete policy from 20260728: delete is now
-- driven by the permission matrix, so who holds it is configurable in Roles.

insert into role_permissions (role, permission)
values ('pod_admin', 'manage_slips')
on conflict do nothing;

-- Keep the implicit superadmin list in step with the matrix.
create or replace function public.my_permissions()
returns setof text
language sql
stable
security definer
set search_path = public
as $$
  select p from (
    select unnest(array[
      'confirm_slips', 'manage_slips', 'manage_categories', 'manage_users',
      'manage_settings', 'manage_directory', 'view_reports'
    ]) as p
    where get_my_role()::text = 'superadmin'
    union
    select permission from role_permissions where role::text = get_my_role()::text
  ) t;
$$;
revoke all on function public.my_permissions() from public;
grant execute on function public.my_permissions() to authenticated;

-- Delete now follows the matrix rather than being hard-wired to superadmin.
drop policy if exists slips_superadmin_delete on admission_slips;
drop policy if exists slips_manage_delete on admission_slips;
create policy slips_manage_delete on admission_slips
  for delete to authenticated
  using (has_perm('manage_slips'));
