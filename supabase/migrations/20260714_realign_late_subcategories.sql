-- Realign "Late" sub-categories to the POD's paper-form reasons
-- Target order: Health · Traffic · OSR · Travel · Woke Up Late · Family Matters
-- Plus keep the existing Weather / Calamity and School-related as extra reasons.
--
-- Strategy: rename the four cleanly-mapped rows in place (preserving their IDs,
-- so existing keywords auto-follow and historical admission_slips keep their
-- original text label), reorder the two kept extras, then insert OSR + Travel.
-- Applied against project ghofeoxrkrcibzeqcbih (dashboard SQL editor).

begin;

-- 1) Rename the four that map cleanly, in place.
update sub_categories set name = 'Health',         sort_order = 1 where id = 3; -- was Health-related
update sub_categories set name = 'Traffic',        sort_order = 2 where id = 1; -- was Transportation
update sub_categories set name = 'Woke Up Late',   sort_order = 5 where id = 2; -- was Overslept
update sub_categories set name = 'Family Matters', sort_order = 6 where id = 4; -- was Family

-- 2) Keep the two extras active, ordered after the six paper reasons.
update sub_categories set sort_order = 7 where id = 5; -- Weather / Calamity
update sub_categories set sort_order = 8 where id = 6; -- School-related

-- 3) Insert the two new reasons (category_id 1 = Late).
insert into sub_categories (category_id, name, suggested_status, document_required, is_active, sort_order)
values
  (1, 'OSR',    'Admit Temporarily', false, true, 3),   -- placeholder: meaning TBD, no keywords yet
  (1, 'Travel', 'Admit Temporarily', false, true, 4);   -- from far / out of town

-- 4) Seed keywords for Travel (OSR intentionally left keyword-less until its
--    meaning is confirmed, so the classifier can't auto-suggest it).
insert into keywords (nature, sub_category_id, keyword, suggested_status, weight, is_active)
select 'Late', sc.id, k.keyword, 'Admit Temporarily', k.weight, true
from sub_categories sc
cross join (values
  ('from province',   2),
  ('out of town',     2),
  ('province',        1),
  ('long commute',    1),
  ('far from school', 1),
  ('lives far',       1),
  ('traveled',        1),
  ('travelled',       1)
) as k(keyword, weight)
where sc.category_id = 1 and sc.name = 'Travel';

commit;
