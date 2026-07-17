-- Phase 5 fix: scope repeat-offender counts to a single school year, so a
-- student's flag resets each year instead of accumulating forever.
--
-- The admission_slips.school_year column is not populated by the kiosk, so we
-- DERIVE the school-year label from created_at rather than trusting that column.
-- The SY start month is admin-configurable via settings.school_year_start_month
-- (default 6 = June; PH school year runs June–May). e.g. with start month 6,
-- 2026-08-15 and 2027-02-10 are both '2026-2027'.
--
-- If you later start storing an explicit school_year on slips, switch the view to
-- use that column AND align its text format to what the client filters on, or
-- flagging will silently match nothing.

-- Admin-configurable SY start month (1–12). Readable by staff, writable by admins
-- (covered by the existing settings_read / settings_admin_write policies).
insert into settings (key, value)
values ('school_year_start_month', '6'::jsonb)
on conflict (key) do nothing;

-- Derive the school-year label for a timestamp given the SY start month.
-- admission_slips.created_at is `timestamp without time zone`, and Postgres does
-- NOT implicitly cast timestamp -> timestamptz during function resolution, so the
-- parameter must be plain `timestamp`. Drop any earlier timestamptz overloads.
drop function if exists public.school_year_of(timestamptz);
drop function if exists public.school_year_of(timestamptz, int);
drop function if exists public.school_year_of(timestamp, int);
create function public.school_year_of(ts timestamp, start_month int)
returns text
language sql
immutable
as $$
  select case
    when extract(month from ts)::int >= start_month
      then extract(year from ts)::int::text || '-' || (extract(year from ts)::int + 1)::text
    else (extract(year from ts)::int - 1)::text || '-' || extract(year from ts)::int::text
  end;
$$;

-- Rebuild the view with a per-school-year breakdown. The configured start month
-- is read once (scalar subquery), so the function stays immutable. Callers filter
-- to the current year (school_year=eq.YYYY-YYYY). security_invoker so it still runs
-- under the caller's RLS.
-- DROP first: create-or-replace can only append columns, and we insert school_year
-- ahead of cnt, which reads as renaming a column and errors (42P16).
drop view if exists student_category_counts;
create view student_category_counts
  with (security_invoker = true) as
with cfg as (
  select coalesce((value #>> '{}')::int, 6) as start_month
  from settings where key = 'school_year_start_month'
)
select
  s.student_id,
  max(s.name)                                                                as name,
  n.nature                                                                   as category,
  public.school_year_of(s.created_at, (select start_month from cfg))         as school_year,
  count(*)::int                                                              as cnt
from admission_slips s
cross join lateral unnest(s.nature) as n(nature)
where s.student_id is not null
group by s.student_id, n.nature, public.school_year_of(s.created_at, (select start_month from cfg));

grant select on student_category_counts to authenticated;
