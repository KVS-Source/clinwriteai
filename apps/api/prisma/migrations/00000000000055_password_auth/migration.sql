-- Phase A: first-party password login (2026-11-02).
--
-- Adds the five columns the password routes read + a unique index on
-- password_reset_token_hash so the reset-password endpoint can lookup
-- a token in O(1) without scanning. Column names stay snake_case to
-- match the project's naming convention (users.legacy_role precedent).
--
-- All columns are nullable or boolean-with-default — safe to apply to
-- an already-seeded DB; existing SSO-only users keep working untouched.

ALTER TABLE "users"
  ADD COLUMN "password_hash"               TEXT,
  ADD COLUMN "must_change_password"        BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "password_reset_token_hash"   TEXT,
  ADD COLUMN "password_reset_expires_at"   TIMESTAMP(3),
  ADD COLUMN "password_changed_at"         TIMESTAMP(3);

CREATE UNIQUE INDEX "users_password_reset_token_hash_key"
  ON "users"("password_reset_token_hash");
