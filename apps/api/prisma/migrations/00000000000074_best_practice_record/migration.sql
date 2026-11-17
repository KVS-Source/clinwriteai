-- Best-Practice digest promoted to a first-class versioned entity
-- (Phase 2 of the pointer refactor). Carries the structured `digest`
-- JSON (principles array + source PDF breadcrumbs) per doc type with
-- an explicit draft → approved → retired workflow. The distill worker
-- writes to drafts; an admin approves to make the digest live.
-- DocumentTypePolicy.bestPracticeDigest stays in place as a backfill-
-- safe read path; Phase 3 drops it once AI assembly has fully migrated.

CREATE TABLE "best_practice_records" (
  "id"             TEXT        PRIMARY KEY,
  "docType"        TEXT        NOT NULL,
  "version"        INTEGER     NOT NULL,
  "status"         TEXT        NOT NULL DEFAULT 'draft',
  "digest"         JSONB       NOT NULL DEFAULT '{"principles":[]}',
  "sourcePdfId"    TEXT,
  "distilledAt"    TIMESTAMP(3),
  "distilledModel" TEXT,
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
CREATE UNIQUE INDEX "best_practice_records_docType_version_key" ON "best_practice_records"("docType", "version");
CREATE INDEX        "best_practice_records_docType_status_idx"  ON "best_practice_records"("docType", "status");
CREATE INDEX        "best_practice_records_status_idx"          ON "best_practice_records"("status");

-- --- Backfill -------------------------------------------------------------
-- For each current DocumentTypePolicy whose bestPracticeDigest carries
-- at least one principle, create an approved BestPracticeRecord v1
-- carrying the full digest JSON. Policies with an empty digest (never
-- distilled) get no row — the resolver falls back to the empty legacy
-- column, same as before.
INSERT INTO "best_practice_records" (
  "id", "docType", "version", "status",
  "digest",
  "sourcePdfId", "distilledAt", "distilledModel",
  "effectiveDate", "approvedBy", "approvedAt",
  "createdBy", "updatedBy", "createdAt", "updatedAt"
)
SELECT
  gen_random_uuid(),
  p."docType",
  1,
  'approved',
  COALESCE(p."bestPracticeDigest", '{"principles":[]}'::jsonb),
  p."bestPracticeDigest"->>'sourcePdfId',
  CASE WHEN p."bestPracticeDigest"->>'distilledAt' IS NOT NULL
    THEN (p."bestPracticeDigest"->>'distilledAt')::timestamp
    ELSE NULL
  END,
  p."bestPracticeDigest"->>'distilledModel',
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
  AND p."bestPracticeDigest" IS NOT NULL
  AND jsonb_array_length(COALESCE(p."bestPracticeDigest"->'principles', '[]'::jsonb)) > 0
ON CONFLICT ("docType", "version") DO NOTHING;

-- --- Document pin columns (nullable; filled on new document creates) ----
ALTER TABLE "documents"
  ADD COLUMN "best_practice_record_id"            TEXT,
  ADD COLUMN "best_practice_version_at_create"    INTEGER;

CREATE INDEX "documents_best_practice_record_id_idx" ON "documents"("best_practice_record_id");
