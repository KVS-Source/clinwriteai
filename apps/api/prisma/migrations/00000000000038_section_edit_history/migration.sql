-- Unified per-section edit history (sPM-section-history).
--
-- Every non-noop section save writes a row here regardless of origin
-- (manual, AI accept, undo, restore). The UI's SectionHistoryPanel reads
-- from this table; AI-only / Manual-only / All filters apply at query time.
-- origin='undo' rows carry their own before/after so the revert itself can
-- be reverted.
--
-- aiCallRecordId is nullable: non-null only when origin='ai', giving a
-- back-link to the AiCallRecord row that carries the prompt + cost
-- metadata. We don't FK-cascade — AiCallRecord deletion is forbidden
-- anyway, and keeping history rows free-standing avoids coupling the
-- history retention policy to the AI cost retention policy.

CREATE TABLE "section_edit_history" (
  "id"                 TEXT         NOT NULL,
  "documentId"         TEXT         NOT NULL,
  "sectionId"          TEXT         NOT NULL,
  "documentVersionId"  TEXT         NOT NULL,
  "actorId"            TEXT         NOT NULL,
  "origin"             TEXT         NOT NULL,   -- 'manual' | 'ai' | 'undo' | 'restore'
  "beforeHtml"         TEXT,
  "afterHtml"          TEXT         NOT NULL,
  "aiCallRecordId"     TEXT,                     -- back-link when origin='ai'
  "revertedFromId"     TEXT,                     -- back-link when origin='undo'
  "createdAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "section_edit_history_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "section_edit_history_documentId_sectionId_createdAt_idx"
  ON "section_edit_history" ("documentId", "sectionId", "createdAt" DESC);

CREATE INDEX "section_edit_history_actorId_idx"
  ON "section_edit_history" ("actorId");

CREATE INDEX "section_edit_history_aiCallRecordId_idx"
  ON "section_edit_history" ("aiCallRecordId");

-- Backfill: synthesise one history row per existing AI call that carries a
-- pre-call snapshot. origin='ai'; afterHtml is unknown (response text isn't
-- stored by the gateway — per the earlier design), so we leave it empty and
-- let the UI render as "AI change (text not retained)". These rows exist so
-- the panel isn't empty for sections that already had AI history.
INSERT INTO "section_edit_history"
  ("id", "documentId", "sectionId", "documentVersionId", "actorId", "origin",
   "beforeHtml", "afterHtml", "aiCallRecordId", "createdAt")
SELECT
  'seh-' || "id",
  "documentId",
  "sectionId",
  "documentVersionId",
  "actorId",
  'ai',
  "preCallSectionHtml",
  '',
  "id",
  "createdAt"
FROM "ai_call_records"
WHERE "documentId"         IS NOT NULL
  AND "sectionId"          IS NOT NULL
  AND "documentVersionId"  IS NOT NULL
  AND "preCallSectionHtml" IS NOT NULL;
