-- Per-section AI drafting trace — one row every time the initial-draft
-- worker (or a validation-pass re-draft) commits a section. Carries the
-- model name, the source documents that were attached to the Claude call,
-- and the prompt / output char counts. Powers the AI Debug per-section
-- drill-down so writers can see WHICH source documents the drafter was
-- looking at when it produced a given section's content.
--
-- Denormalised `sourceTitles` — stored as a parallel text[] alongside
-- `sourceIds` — lets /ai-debug render the trace without an extra join to
-- the source_documents table (sources rarely get renamed; if a title
-- drifts the trace shows what it was AT DRAFT TIME, which is what the
-- writer wants to know for the validation question).

CREATE TABLE "ai_section_draft_traces" (
  "id"                TEXT PRIMARY KEY,
  "documentId"        TEXT    NOT NULL,
  "documentVersionId" TEXT,
  "sectionId"         TEXT    NOT NULL,
  "sectionNumber"     TEXT    NOT NULL,
  "sectionTitle"      TEXT    NOT NULL,
  "model"             TEXT    NOT NULL,
  "sourceIds"         TEXT[]  NOT NULL DEFAULT '{}',
  "sourceTitles"      TEXT[]  NOT NULL DEFAULT '{}',
  "promptCharCount"   INTEGER NOT NULL,
  "outputCharCount"   INTEGER NOT NULL,
  "draftedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "ai_section_draft_traces_doc_idx"
  ON "ai_section_draft_traces" ("documentId", "draftedAt" DESC);

CREATE INDEX "ai_section_draft_traces_section_idx"
  ON "ai_section_draft_traces" ("documentId", "sectionId", "draftedAt" DESC);
