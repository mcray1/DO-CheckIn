-- Phase 4 (Category/Rules manager): let POD admins add/edit categories,
-- sub_categories, and keywords from the app. Reads stay public (the anon kiosk
-- must load them); writes are admin-only via get_my_role(). The `for all` admin
-- policy also lets admins SELECT inactive rows so they can reactivate them.

-- categories --------------------------------------------------------------
grant insert, update, delete on categories to authenticated;
drop policy if exists categories_admin_write on categories;
create policy categories_admin_write on categories
  for all to authenticated
  using (get_my_role() in ('pod_admin', 'superadmin'))
  with check (get_my_role() in ('pod_admin', 'superadmin'));

-- sub_categories ----------------------------------------------------------
grant insert, update, delete on sub_categories to authenticated;
drop policy if exists sub_categories_admin_write on sub_categories;
create policy sub_categories_admin_write on sub_categories
  for all to authenticated
  using (get_my_role() in ('pod_admin', 'superadmin'))
  with check (get_my_role() in ('pod_admin', 'superadmin'));

-- keywords ----------------------------------------------------------------
grant insert, update, delete on keywords to authenticated;
drop policy if exists keywords_admin_write on keywords;
create policy keywords_admin_write on keywords
  for all to authenticated
  using (get_my_role() in ('pod_admin', 'superadmin'))
  with check (get_my_role() in ('pod_admin', 'superadmin'));

-- Inserts need access to the identity/serial sequences behind the PKs.
grant usage, select on all sequences in schema public to authenticated;
