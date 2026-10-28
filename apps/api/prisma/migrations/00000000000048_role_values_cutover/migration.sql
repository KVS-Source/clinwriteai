-- Role values cutover — translate User.role + Membership.role + User.capabilities
-- from the legacy strings to the canonical post-RBAC-refactor values.
--
-- Mapping (per docs/roles-and-permissions.md §8):
--
--   User.role (legacy)              → User.role (canonical)   + capabilities
--   -------------------------------   ------------------------   -----------------------
--   super-admin                       tenant-admin               []
--   admin                             tenant-admin               []
--   clinical-writer                   contributor                [can-author]
--   scientific-writer                 contributor                [can-author]
--   medical-writer                    contributor                [can-author, can-review]
--   regulatory-writer                 contributor                [can-author, can-publish]
--   ideation-lead                     contributor                [can-author]
--   reviewer                          contributor                [can-review]
--   read-only                         auditor                    []
--
--   Membership.role (legacy)        → Membership.role (canonical)
--   -------------------------------   ----------------------------
--   owner                             tenant-admin
--   admin                             tenant-admin
--   writer                            contributor
--   reviewer                          contributor
--   viewer                            auditor
--
-- Pre-condition: migration 47 has already added `legacy_role` and `capabilities`
-- columns to `users`. This migration snapshots the current role into legacy_role
-- (idempotent — guarded by legacy_role IS NULL so a re-run doesn't overwrite),
-- then rewrites the role and populates capabilities in a single UPDATE per
-- old value.
--
-- Safety: wrapped in a single transaction via Prisma's default. If any UPDATE
-- fails the whole migration rolls back and the DB is unchanged.
--
-- Compatibility: rbac.ts was updated in the same commit with a legacy-alias
-- layer, so a mix of legacy and canonical role values authenticates equivalently
-- while a staged rollout is in progress.

-- ---------------------------------------------------------------------------
-- Snapshot current role → legacy_role (only for users not already snapshotted).
-- ---------------------------------------------------------------------------
UPDATE "users" SET "legacy_role" = "role" WHERE "legacy_role" IS NULL;

-- ---------------------------------------------------------------------------
-- User.role + capabilities per mapping above.
-- One UPDATE per legacy value so capability derivation stays explicit.
-- ---------------------------------------------------------------------------
UPDATE "users"
   SET "role" = 'tenant-admin',
       "capabilities" = ARRAY[]::TEXT[]
 WHERE "role" IN ('super-admin', 'admin');

UPDATE "users"
   SET "role" = 'contributor',
       "capabilities" = ARRAY['can-author']::TEXT[]
 WHERE "role" IN ('clinical-writer', 'scientific-writer', 'ideation-lead');

UPDATE "users"
   SET "role" = 'contributor',
       "capabilities" = ARRAY['can-author', 'can-review']::TEXT[]
 WHERE "role" = 'medical-writer';

UPDATE "users"
   SET "role" = 'contributor',
       "capabilities" = ARRAY['can-author', 'can-publish']::TEXT[]
 WHERE "role" = 'regulatory-writer';

UPDATE "users"
   SET "role" = 'contributor',
       "capabilities" = ARRAY['can-review']::TEXT[]
 WHERE "role" = 'reviewer';

UPDATE "users"
   SET "role" = 'auditor',
       "capabilities" = ARRAY[]::TEXT[]
 WHERE "role" = 'read-only';

-- ---------------------------------------------------------------------------
-- Membership.role per mapping above.
-- Membership.role is modeled but not actively checked in route handlers yet
-- (see docs/roles-and-permissions.md §1); rewriting values keeps the field
-- interpretable under the new vocabulary.
-- ---------------------------------------------------------------------------
UPDATE "memberships"
   SET "role" = 'tenant-admin'
 WHERE "role" IN ('owner', 'admin');

UPDATE "memberships"
   SET "role" = 'contributor'
 WHERE "role" IN ('writer', 'reviewer');

UPDATE "memberships"
   SET "role" = 'auditor'
 WHERE "role" = 'viewer';
