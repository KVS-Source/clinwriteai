-- AI Prompt promoted to a first-class versioned entity (Phase 1 of the
-- pointer refactor). Carries the SME prompt + parsed section rules per
-- doc type with an explicit draft → approved → retired workflow.
-- DocumentTypePolicy.smePrompt + .sectionRules stay in place for now as a
-- backfill-safe read path; Phase 3 drops them once AI assembly has been
-- fully migrated.

CREATE TABLE "ai_prompt_records" (
  "id"             TEXT        PRIMARY KEY,
  "docType"        TEXT        NOT NULL,
  "version"        INTEGER     NOT NULL,
  "status"         TEXT        NOT NULL DEFAULT 'draft',
  "smePrompt"      TEXT        NOT NULL,
  "sectionRules"   JSONB       NOT NULL DEFAULT '{}',
  "supersededBy"   TEXT,
  "effectiveDate"  TIMESTAMP(3),
  "retiredAt"      TIMESTAMP(3),
  "retireReason"   TEXT,
  "approvedBy"     TEXT,
  "approvedAt"     TIMESTAMP(3),
  "createdBy"      TEXT        NOT NULL,
  "updatedBy"      TEXT        NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "ai_prompt_records_docType_version_key" ON "ai_prompt_records"("docType", "version");
CREATE INDEX        "ai_prompt_records_docType_status_idx"  ON "ai_prompt_records"("docType", "status");
CREATE INDEX        "ai_prompt_records_status_idx"          ON "ai_prompt_records"("status");

-- --- Backfill -------------------------------------------------------------
-- For each existing current DocumentTypePolicy, create an approved
-- AiPromptRecord v1 carrying its smePrompt + sectionRules. This makes
-- every production policy have a pointer-resolvable AiPromptRecord
-- before any API code changes. Legacy fallback in AI assembly will still
-- read from policy.smePrompt until Phase 3.
INSERT INTO "ai_prompt_records" (
  "id", "docType", "version", "status",
  "smePrompt", "sectionRules",
  "effectiveDate", "approvedBy", "approvedAt",
  "createdBy", "updatedBy", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(),
  p."docType",
  1,
  'approved',
  p."smePrompt",
  COALESCE(p."sectionRules", '{}'::jsonb),
  p."createdAt",
  p."createdBy",
  p."createdAt",
  p."createdBy",
  p."updatedBy",
  p."createdAt",
  p."updatedAt"
FROM "document_type_policies" p
WHERE p."isCurrent" = true
  AND p."retiredAt" IS NULL
  AND LENGTH(TRIM(p."smePrompt")) > 0
ON CONFLICT ("docType", "version") DO NOTHING;

-- --- Document pin columns (nullable; filled on new document creates) ----
ALTER TABLE "documents"
  ADD COLUMN "ai_prompt_record_id"           TEXT,
  ADD COLUMN "ai_prompt_version_at_create"   INTEGER;

CREATE INDEX "documents_ai_prompt_record_id_idx" ON "documents"("ai_prompt_record_id");
