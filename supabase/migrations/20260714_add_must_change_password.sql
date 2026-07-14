-- Phase 4 (User Management): force a password change on first login.
-- Admin-created accounts get a temp password + must_change_password = true;
-- the app shows a mandatory change-password screen until the user resets it.
-- Existing accounts default to false so no current user is forced to reset.

alter table profiles
  add column if not exists must_change_password boolean not null default false;
