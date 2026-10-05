-- Postgres row-level security infrastructure (Phase 5 operational hardening).
--
-- Shape: permissive policies that activate ONLY when the connecting session
-- has set `app.tenant_id`. The current API doesn't set this GUC, so RLS is
-- a passthrough for every query today — no behavior change. Prod can start
-- doing `SET LOCAL app.tenant_id = '<tenant>'` at the top of each
-- request-scoped transaction to activate enforcement; defence-in-depth
-- against an app-layer tenant filter bug.
--
-- Why permissive-by-default: strict RLS requires Prisma to set the GUC on
-- every borrowed connection, which collides with Prisma's connection pool
-- (GUCs are per-session, not per-query). The permissive pattern lets us
-- ship the infrastructure now without the pool refactor.
--
-- Covered tables: projects (direct tenantId), documents, publications,
-- med_content_items, regulatory_submissions, ideation_projects. All six
-- are the top-level per-project aggregates; downstream child tables inherit
-- isolation through FKs + API filtering + (optionally) further RLS added
-- the same way later.
--
-- Activation checklist (future):
--   1. Decide tenant_id propagation strategy (middleware SET LOCAL per
--      Prisma $transaction, OR connection role swap + BYPASSRLS removal).
--   2. Audit all queries to ensure they run inside the transaction that
--      sets the GUC.
--   3. Flip the policy to strict (remove the `NULL/''` bypass branch).
--   4. Verify every integration test still passes.
-- audit_events DROP filtered per ADR 0002.

-- =============================================================================
-- projects — direct tenantId column
-- =============================================================================
ALTER TABLE "projects" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "projects"
  FOR ALL
  USING (
    current_setting('app.tenant_id', true) IS NULL
    OR current_setting('app.tenant_id', true) = ''
    OR "tenantId" = current_setting('app.tenant_id', true)
  );

-- =============================================================================
-- documents — projectId → projects.tenantId
-- =============================================================================
ALTER TABLE "documents" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "documents"
  FOR ALL
  USING (
    current_setting('app.tenant_id', true) IS NULL
    OR current_setting('app.tenant_id', true) = ''
    OR "projectId" IN (
      SELECT id FROM "projects"
      WHERE "tenantId" = current_setting('app.tenant_id', true)
    )
  );

-- =============================================================================
-- publications — projectId → projects.tenantId
-- =============================================================================
ALTER TABLE "publications" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "publications"
  FOR ALL
  USING (
    current_setting('app.tenant_id', true) IS NULL
    OR current_setting('app.tenant_id', true) = ''
    OR "projectId" IN (
      SELECT id FROM "projects"
      WHERE "tenantId" = current_setting('app.tenant_id', true)
    )
  );

-- =============================================================================
-- med_content_items — projectId → projects.tenantId
-- =============================================================================
ALTER TABLE "med_content_items" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "med_content_items"
  FOR ALL
  USING (
    current_setting('app.tenant_id', true) IS NULL
    OR current_setting('app.tenant_id', true) = ''
    OR "projectId" IN (
      SELECT id FROM "projects"
      WHERE "tenantId" = current_setting('app.tenant_id', true)
    )
  );

-- =============================================================================
-- regulatory_submissions — projectId → projects.tenantId
-- =============================================================================
ALTER TABLE "regulatory_submissions" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "regulatory_submissions"
  FOR ALL
  USING (
    current_setting('app.tenant_id', true) IS NULL
    OR current_setting('app.tenant_id', true) = ''
    OR "projectId" IN (
      SELECT id FROM "projects"
      WHERE "tenantId" = current_setting('app.tenant_id', true)
    )
  );

-- =============================================================================
-- ideation_projects — projectId → projects.tenantId
-- =============================================================================
ALTER TABLE "ideation_projects" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation ON "ideation_projects"
  FOR ALL
  USING (
    current_setting('app.tenant_id', true) IS NULL
    OR current_setting('app.tenant_id', true) = ''
    OR "projectId" IN (
      SELECT id FROM "projects"
      WHERE "tenantId" = current_setting('app.tenant_id', true)
    )
  );
