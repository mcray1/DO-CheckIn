-- Absent slips record WHICH past day the student missed, separate from `date`
-- (the day the slip was filed). Date only — no time component.
--
-- The kiosk blocks future dates in two ways: the picker's max attribute and a
-- validation check before submit. If you later want the database to enforce it
-- too, add the guard to the kiosk insert policy's WITH CHECK, e.g.
--   (absence_date is null or absence_date <= current_date)

-- An absence can span one day or several. absence_date is the first day and
-- absence_end_date the last; for a single-day absence they are the same.
alter table admission_slips
  add column if not exists absence_date date;

alter table admission_slips
  add column if not exists absence_end_date date;

comment on column admission_slips.absence_date is
  'First day the student was absent (Absent category only). NULL otherwise.';
comment on column admission_slips.absence_end_date is
  'Last day of the absence; equals absence_date for a single-day absence.';
