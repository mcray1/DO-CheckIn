-- Harden the public kiosk INSERT.
--
-- The kiosk is intentionally unauthenticated, so it runs as `anon` using the
-- public anon key that ships in the JS bundle. The previous policy was
-- `with check (true)`, which let anyone holding that key write ANY column —
-- including posting a slip that already looks confirmed, or one claiming an
-- adviser email of their choosing with unbounded text.
--
-- This restricts an anonymous submission to what the kiosk actually sends:
-- an unconfirmed, un-notified slip with sane field lengths. Review/confirmation
-- stays the exclusive job of the pod_update policy (has_perm('confirm_slips')).
--
-- Not addressed here (no DB fix): submission volume. Rate limiting belongs at
-- the edge/CDN; the length caps at least bound the damage per request.

drop policy if exists kiosk_insert on admission_slips;
create policy kiosk_insert on admission_slips
  for insert to anon, authenticated
  with check (
    -- Must arrive unreviewed.
    status is null
    and final_sub_category is null
    and confirmed_by is null
    and confirmed_at is null
    -- Must arrive un-notified, so a forged row can't suppress or fake an email.
    and coalesce(notification_sent, false) = false
    and notification_sent_at is null
    -- Bound the free-text fields (reason is student-typed and reaches an inbox).
    and char_length(coalesce(reason, '')) <= 500
    and char_length(coalesce(name, '')) <= 120
    and char_length(coalesce(grade_section, '')) <= 80
    and char_length(coalesce(student_id, '')) <= 40
    and char_length(coalesce(teacher_email, '')) <= 160
    -- A slip must name a student and a category.
    and name is not null
    and category_id is not null
  );
