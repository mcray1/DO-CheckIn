-- Let a superadmin permanently delete an admission slip.
--
-- Deliberately superadmin-only: confirming a slip is reversible (re-open and
-- change it), but deleting destroys the record and its notification history.
-- No other role gets this, and it is not part of the permission matrix so it
-- can't be handed out by accident.

-- notification_log rows point at a slip; without a cascade the delete fails on
-- the foreign key. Cascading keeps a slip and its send history atomic.
do $$
declare fk_name text;
begin
  select conname into fk_name
  from pg_constraint
  where conrelid = 'notification_log'::regclass
    and contype = 'f'
    and confrelid = 'admission_slips'::regclass
  limit 1;

  if fk_name is not null then
    execute format('alter table notification_log drop constraint %I', fk_name);
  end if;

  alter table notification_log
    add constraint notification_log_slip_id_fkey
    foreign key (slip_id) references admission_slips(id) on delete cascade;
end $$;

grant delete on admission_slips to authenticated;

drop policy if exists slips_superadmin_delete on admission_slips;
create policy slips_superadmin_delete on admission_slips
  for delete to authenticated
  using (get_my_role()::text = 'superadmin');
