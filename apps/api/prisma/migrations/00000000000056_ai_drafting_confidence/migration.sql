-- AI drafting state + confidence rubric (2026-11-02).
--
-- Backs the "AI confidence score + Drafting Report" surface. Writes
-- come from apps/worker/src/jobs/ai-validation-pass.ts at the end of
-- every pass; reads from GET /documents/:id/ai-draft-status.
--
-- All columns are nullable / defaulted — safe to apply to a seeded DB.
-- Existing documents (no AI draft) have NULL state + NULL confidence;
-- the UI reads NULL as "no AI drafting attempted".

ALTER TABLE "documents"
  ADD COLUMN "ai_draft_state"          TEXT,
  ADD COLUMN "ai_confidence_overall"   INTEGER,
  ADD COLUMN "ai_last_pass_at"         TIMESTAMP(3),
  ADD COLUMN "ai_last_pass_number"     INTEGER;

ALTER TABLE "section_contents"
  ADD COLUMN "ai_confidence"           INTEGER,
  ADD COLUMN "ai_flags"                TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Per-pass log for the "AI Drafting Report" panel. One row per
-- ai_validation_pass execution.
CREATE TABLE "ai_drafting_passes" (
  "id"               TEXT        PRIMARY KEY,
  "document_id"      TEXT        NOT NULL,
  "version_id"       TEXT        NOT NULL,
  "pass_number"      INTEGER     NOT NULL,
  "started_at"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "finished_at"      TIMESTAMP(3),
  "sections_flagged" INTEGER     NOT NULL DEFAULT 0,
  "confidence_after" INTEGER,
  "model_used"       TEXT,
  "flags_json"       JSONB       NOT NULL DEFAULT '[]'::jsonb,

  CONSTRAINT "ai_drafting_passes_document_id_fkey"
    FOREIGN KEY ("document_id") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "ai_drafting_passes_document_id_pass_number_key"
  ON "ai_drafting_passes"("document_id", "pass_number");

CREATE INDEX "ai_drafting_passes_document_id_idx"
  ON "ai_drafting_passes"("document_id");
