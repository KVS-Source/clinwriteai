-- Phase M-B.3 — Publication gains an AI drafter state + authored
-- aiInstructions column so the initial-draft worker can rely on the
-- same state machine Module A documents already carry.

ALTER TABLE "publications"
  ADD COLUMN "ai_draft_state"  TEXT  NOT NULL DEFAULT 'idle',
  ADD COLUMN "ai_instructions" TEXT;

CREATE INDEX "publications_ai_draft_state_idx" ON "publications"("ai_draft_state");
