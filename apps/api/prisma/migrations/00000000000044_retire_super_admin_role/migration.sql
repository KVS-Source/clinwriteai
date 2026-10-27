-- Phase 3 of the Clinical Writing pivot — retire the 'super-admin' role.
--
-- Collapse decision (sPM/CLAUDE.md, 2026-10-27):
--   - 'admin' becomes the single top-of-hierarchy role.
--   - Platform-level vs. tenant-level admin is encoded in User.tenantId
--     (null = platform admin, string = tenant-scoped admin).
--   - Every privilege that used to require 'super-admin' is now gated on
--     'admin' + tenantId=null (see rbac.ts, tenants/sso/memberships routes).
--
-- This migration just normalises any surviving data. No column changes
-- (role is a free-text column), no FK updates. Idempotent — a re-run on
-- a DB with no 'super-admin' rows is a zero-row UPDATE.

UPDATE "users"
SET    "role" = 'admin'
WHERE  "role" = 'super-admin';
