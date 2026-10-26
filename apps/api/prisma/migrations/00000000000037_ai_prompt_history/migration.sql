-- Add prompt-history + Undo columns to ai_call_records (sPM-history).
--
-- Nullable throughout — historical rows written before this migration stay
-- valid; only new ai_suggest calls populate them.

ALTER TABLE "ai_call_records"
  ADD COLUMN "promptText"                 TEXT,
  ADD COLUMN "preCallSectionHtml"         TEXT,
  ADD COLUMN "documentId"                 TEXT,
  ADD COLUMN "sectionId"                  TEXT,
  ADD COLUMN "documentVersionId"          TEXT,
  ADD COLUMN "postCallDocumentVersionId"  TEXT,
  ADD COLUMN "undoneAt"                   TIMESTAMP(3),
  ADD COLUMN "undoneBy"                   TEXT,
  ADD COLUMN "promptMeta"                 JSONB;

CREATE INDEX "ai_call_records_documentId_sectionId_createdAt_idx"
  ON "ai_call_records" ("documentId", "sectionId", "createdAt");
