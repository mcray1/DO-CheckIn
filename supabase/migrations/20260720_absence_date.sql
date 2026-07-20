-- Absent slips record WHICH past day the student missed, separate from `date`
-- (the day the slip was filed). Date only — no time component.
--
-- The kiosk blocks future dates in two ways: the picker's max attribute and a
-- validation check before submit. If you later want the database to enforce it
-- too, add the guard to the kiosk insert policy's WITH CHECK, e.g.
--   (absence_date is null or absence_date <= current_date)

alter table admission_slips
  add column if not exists absence_date date;

comment on column admission_slips.absence_date is
  'The past date the student was absent (Absent category only). NULL for other categories.';
