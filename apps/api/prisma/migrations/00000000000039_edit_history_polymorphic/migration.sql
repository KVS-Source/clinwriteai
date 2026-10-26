-- Polymorphic edit history (sPM-edit-history-polymorphic).
--
-- Generalises section_edit_history (Module A sections) into a single
-- edit_history table that captures per-entity-type edits across modules.
-- The existing clinical-section columns (documentId/sectionId/
-- documentVersionId) stay as "convenience" columns populated for
-- entityType='clinical_section' rows — zero behavior change for Module A.
--
-- Future entity types (atomised_content, peer_review_response, ha_response_draft,
-- slide, …) use entityType + entityId + subUnitId to identify what was edited.
--
-- Approach: rename table + add new columns + backfill in place. No data
-- movement; existing SectionEditHistory API shapes continue to work via
-- the convenience columns.

-- 1. Rename table
ALTER TABLE "section_edit_history" RENAME TO "edit_history";

-- 2. Add polymorphic columns (nullable so existing rows don't require backfill
--    on write; we backfill below with a single UPDATE)
ALTER TABLE "edit_history"
  ADD COLUMN "entityType"  TEXT,                        -- 'clinical_section' | 'atomised_content' | 'peer_review_response' | 'ha_response_draft' | 'slide' | ...
  ADD COLUMN "entityId"    TEXT,                        -- primary entity key (document id, publication id, submission id, deck id, ...)
  ADD COLUMN "subUnitId"   TEXT;                        -- optional sub-key (section id, channel, question id, slide id)

-- 3. Backfill: every existing row is a clinical section edit
UPDATE "edit_history"
   SET "entityType" = 'clinical_section',
       "entityId"   = "documentId",
       "subUnitId"  = "sectionId"
 WHERE "entityType" IS NULL;

-- 4. Make the two main polymorphic columns NOT NULL now that they're populated
ALTER TABLE "edit_history" ALTER COLUMN "entityType" SET NOT NULL;
ALTER TABLE "edit_history" ALTER COLUMN "entityId"   SET NOT NULL;

-- 5. Rename the existing composite index on (documentId, sectionId, createdAt) to
--    reflect the new table name, and add a polymorphic index for cross-module lookups
ALTER INDEX "section_edit_history_documentId_sectionId_createdAt_idx"
  RENAME TO "edit_history_documentId_sectionId_createdAt_idx";
ALTER INDEX "section_edit_history_actorId_idx"         RENAME TO "edit_history_actorId_idx";
ALTER INDEX "section_edit_history_aiCallRecordId_idx"  RENAME TO "edit_history_aiCallRecordId_idx";

CREATE INDEX "edit_history_entityType_entityId_subUnitId_createdAt_idx"
  ON "edit_history" ("entityType", "entityId", "subUnitId", "createdAt" DESC);
