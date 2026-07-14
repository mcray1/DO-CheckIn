-- Phase 4: let a signed-in user clear their own must_change_password flag after
-- they set a new password (via supabase.auth.updateUser) on the forced
-- change-password screen. Security-definer so it can update the profiles row
-- without a broad "update own profile" RLS policy (which would risk letting a
-- user change their own role or is_active). It only ever touches the caller's
-- own row and only this one flag.

create or replace function public.clear_my_password_flag()
returns void
language sql
security definer
set search_path = public
as $$
  update profiles
     set must_change_password = false,
         updated_at = now()
   where id = auth.uid();
$$;

revoke all on function public.clear_my_password_flag() from public;
grant execute on function public.clear_my_password_flag() to authenticated;
