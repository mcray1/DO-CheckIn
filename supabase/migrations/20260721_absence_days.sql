-- Half-day absences. absence_days holds the fractional day count (supports .5),
-- so a span whose first or last day is a half counts as e.g. 3.5. Populated by
-- the kiosk; the monitoring sheet's "Absences" column reads it directly.
alter table admission_slips
  add column if not exists absence_days numeric(4, 1);

comment on column admission_slips.absence_days is
  'Fractional day count for an absence (e.g. 3.5). NULL for non-absence slips.';

-- Which half a partial day covers, e.g. "morning", "afternoon", or for a range
-- "first day afternoon, last day morning". NULL when no day is a half day.
alter table admission_slips
  add column if not exists absence_half text;

comment on column admission_slips.absence_half is
  'Human-readable note of which half(s) a partial absence covers.';
