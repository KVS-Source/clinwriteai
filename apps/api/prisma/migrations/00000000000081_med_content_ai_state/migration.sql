-- Phase M-C.3 — MedContentItem gains AI drafter state + authored
-- aiInstructions so the initial-draft worker + validation loop can
-- rely on the same state machine clinical + scientific writing use.

ALTER TABLE "med_content_items"
  ADD COLUMN "ai_draft_state_c"  TEXT  NOT NULL DEFAULT 'idle',
  ADD COLUMN "ai_instructions_c" TEXT;

CREATE INDEX "med_content_items_ai_draft_state_c_idx"
  ON "med_content_items"("ai_draft_state_c");
