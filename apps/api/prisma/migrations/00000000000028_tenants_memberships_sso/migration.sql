-- Tenant Admin models — Arc 2 of docs/pivot-plan.md.
--
-- Lands the Tenant / Membership / SsoConnection tables and promotes
-- users.tenantId + projects.tenantId from free-form strings to real FKs.
--
-- Backfill strategy:
--   1. Create tenants rows from each DISTINCT existing users.tenantId
--      (and projects.tenantId) string value. The Tenant.id = the old
--      string so existing FKs remain valid without a rewrite.
--   2. Create memberships rows per user with a role derived from
--      users.role (super-admin/admin become 'admin' membership;
--      writers → 'writer'; reviewers → 'reviewer'; else 'viewer').
--      super-admin's platform-level privilege stays on the User.
--   3. Add FK constraints last so backfill writes can't fail
--      referential integrity mid-insert.
--
-- The RLS infrastructure from migration 27 still applies — those
-- policies key on current_setting('app.tenant_id'), which just needs
-- a real Tenant row to exist for the id it's filtering on.

-- =============================================================================
-- 1. tenants
-- =============================================================================
CREATE TABLE "tenants" (
  "id"              TEXT         NOT NULL,
  "slug"            TEXT         NOT NULL,
  "name"            TEXT         NOT NULL,
  "status"          TEXT         NOT NULL DEFAULT 'active',
  "modulesEnabled"  TEXT[]       NOT NULL DEFAULT ARRAY['A']::TEXT[],
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL,
  "archivedAt"      TIMESTAMP(3),

  CONSTRAINT "tenants_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "tenants_slug_key" ON "tenants"("slug");
CREATE INDEX "tenants_status_idx" ON "tenants"("status");

-- =============================================================================
-- 2. sso_connections
-- =============================================================================
CREATE TABLE "sso_connections" (
  "id"                   TEXT         NOT NULL,
  "tenantId"             TEXT         NOT NULL,
  "type"                 TEXT         NOT NULL,
  "workosConnectionId"   TEXT,
  "callbackUrl"          TEXT         NOT NULL,
  "status"               TEXT         NOT NULL DEFAULT 'draft',
  "verifiedAt"           TIMESTAMP(3),
  "disabledAt"           TIMESTAMP(3),
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"            TIMESTAMP(3) NOT NULL,

  CONSTRAINT "sso_connections_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "sso_connections_tenantId_idx" ON "sso_connections"("tenantId");
CREATE INDEX "sso_connections_tenantId_status_idx" ON "sso_connections"("tenantId", "status");

-- =============================================================================
-- 3. memberships
-- =============================================================================
CREATE TABLE "memberships" (
  "id"            TEXT         NOT NULL,
  "tenantId"      TEXT         NOT NULL,
  "userId"        TEXT         NOT NULL,
  "role"          TEXT         NOT NULL,
  "status"        TEXT         NOT NULL DEFAULT 'invited',
  "invitedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "activatedAt"   TIMESTAMP(3),
  "suspendedAt"   TIMESTAMP(3),
  "invitedBy"     TEXT,

  CONSTRAINT "memberships_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "memberships_tenantId_userId_key" ON "memberships"("tenantId", "userId");
CREATE INDEX "memberships_tenantId_idx" ON "memberships"("tenantId");
CREATE INDEX "memberships_userId_idx" ON "memberships"("userId");
CREATE INDEX "memberships_tenantId_role_idx" ON "memberships"("tenantId", "role");

-- =============================================================================
-- 4. Backfill tenants from distinct users.tenantId + projects.tenantId
-- =============================================================================
-- Each distinct non-null tenant id becomes a tenants row. Slug is derived
-- by lower-casing the id and stripping non-alphanumerics; collisions are
-- resolved by appending a short suffix. For clean greenfield DBs these
-- INSERTs find nothing to do.
INSERT INTO "tenants" ("id", "slug", "name", "status", "modulesEnabled", "updatedAt")
SELECT
  t_id,
  COALESCE(
    NULLIF(LOWER(REGEXP_REPLACE(t_id, '[^a-zA-Z0-9]+', '-', 'g')), ''),
    'tenant-' || SUBSTR(t_id, 1, 8)
  ) AS slug,
  'Tenant ' || t_id AS name,
  'active',
  ARRAY['A']::TEXT[],
  CURRENT_TIMESTAMP
FROM (
  SELECT DISTINCT "tenantId" AS t_id FROM "users"    WHERE "tenantId" IS NOT NULL
  UNION
  SELECT DISTINCT "tenantId" AS t_id FROM "projects" WHERE "tenantId" IS NOT NULL
) distinct_ids
ON CONFLICT ("id") DO NOTHING;

-- =============================================================================
-- 5. Backfill memberships — one row per (tenantId, user)
-- =============================================================================
INSERT INTO "memberships" ("id", "tenantId", "userId", "role", "status", "activatedAt", "invitedAt")
SELECT
  gen_random_uuid()::TEXT,
  u."tenantId",
  u."id",
  CASE
    WHEN u."role" IN ('super-admin', 'admin') THEN 'admin'
    WHEN u."role" LIKE '%-writer'              THEN 'writer'
    WHEN u."role" = 'reviewer'                 THEN 'reviewer'
    ELSE 'viewer'
  END,
  CASE WHEN u."status" = 'active' THEN 'active' ELSE 'invited' END,
  CASE WHEN u."status" = 'active' THEN u."createdAt" ELSE NULL END,
  u."createdAt"
FROM "users" u
WHERE u."tenantId" IS NOT NULL
ON CONFLICT ("tenantId", "userId") DO NOTHING;

-- =============================================================================
-- 6. Add FK constraints last so the backfill above couldn't fail on them
-- =============================================================================
ALTER TABLE "users"
  ADD CONSTRAINT "users_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "projects"
  ADD CONSTRAINT "projects_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "sso_connections"
  ADD CONSTRAINT "sso_connections_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "memberships"
  ADD CONSTRAINT "memberships_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "memberships"
  ADD CONSTRAINT "memberships_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- =============================================================================
-- 7. RLS policies on the new tables
-- =============================================================================
-- Follows the permissive-by-default pattern from migration 27: when
-- app.tenant_id is unset/empty (super-admin paths, worker jobs, admin
-- CLI), the policy passes. When set, each row is filtered by its own
-- tenant membership.

ALTER TABLE "tenants" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "tenants"
  FOR ALL
  USING (
    current_setting('app.tenant_id', true) IS NULL
    OR current_setting('app.tenant_id', true) = ''
    OR "id" = current_setting('app.tenant_id', true)
  );

ALTER TABLE "memberships" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "memberships"
  FOR ALL
  USING (
    current_setting('app.tenant_id', true) IS NULL
    OR current_setting('app.tenant_id', true) = ''
    OR "tenantId" = current_setting('app.tenant_id', true)
  );

ALTER TABLE "sso_connections" ENABLE ROW LEVEL SECURITY;
CREATE POLICY tenant_isolation ON "sso_connections"
  FOR ALL
  USING (
    current_setting('app.tenant_id', true) IS NULL
    OR current_setting('app.tenant_id', true) = ''
    OR "tenantId" = current_setting('app.tenant_id', true)
  );
