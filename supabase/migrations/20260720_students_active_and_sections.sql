-- Two fixes for directory management.
--
-- 1. students.is_active did not actually exist (the project notes listed it, the
--    table never had it). Needed so students can be deactivated instead of
--    deleted, keeping historical admission slips intact.
alter table students
  add column if not exists is_active boolean not null default true;

-- 2. Advisers pick their section from the sections students are really in, so a
--    typo can't silently break kiosk adviser matching. security_invoker so it
--    runs under the caller's RLS (students are publicly readable).
drop view if exists student_sections;
create view student_sections
  with (security_invoker = true) as
select distinct
  level,
  section
from students
where section is not null
  and btrim(section) <> '';

grant select on student_sections to authenticated;
grant select on student_sections to anon;
