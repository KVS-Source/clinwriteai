-- Document Brief Open Flags — persistent escape-hatch tokens from the
-- AI (2026-11-07).
--
-- The AI carry-prompt instructs the model to emit bracketed flag tokens
-- instead of fabricating; step C of the carry-prompt rollout parses
-- them off the response. This table is where they LIVE after that
-- parse. Kept out of document_briefs.content_json because the brief is
-- regenerated on structural events — overlaying flags from here at read
-- time prevents a regen from wiping the AI's findings.
--
-- Dedup policy: inserts are an application-side no-op when an open row
-- already exists for (document_id, section_id, type, text). A partial
-- unique index would also work; we chose application-side so the error
-- path stays simple + we can also skip-and-still-return without a
-- Prisma P2002.
--
-- Columns:
--   type              — one of the four token labels, snake-cased:
--                       information_required | conflict |
--                       reference_verification_required |
--                       missing_cross_ref_target
--   text              — body of the bracketed phrase, trimmed
--   ai_call_record_id — provenance to the originating AiCallRecord
--   status            — 'open' | 'resolved' | 'dismissed'
--   resolved_by / _at / note — Part 11-style resolution metadata
--
-- Indexes:
--   (document_id)                      overlay-by-doc at brief read
--   (document_id, section_id)          per-section overlay + jump-to
--   (document_id, status)              list open vs resolved

CREATE TABLE "document_brief_open_flags" (
  "id"                TEXT        PRIMARY KEY,
  "document_id"       TEXT        NOT NULL,
  "section_id"        TEXT        NOT NULL,
  "type"              TEXT        NOT NULL,
  "text"              TEXT        NOT NULL,
  "ai_call_record_id" TEXT,
  "status"            TEXT        NOT NULL DEFAULT 'open',
  "resolved_by"       TEXT,
  "resolved_at"       TIMESTAMP(3),
  "resolution_note"   TEXT,
  "created_at"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"        TIMESTAMP(3) NOT NULL,

  CONSTRAINT "document_brief_open_flags_document_id_fkey"
    FOREIGN KEY ("document_id")
    REFERENCES "documents" ("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE
);

CREATE INDEX "document_brief_open_flags_document_id_idx"
  ON "document_brief_open_flags" ("document_id");

CREATE INDEX "document_brief_open_flags_document_id_section_id_idx"
  ON "document_brief_open_flags" ("document_id", "section_id");

CREATE INDEX "document_brief_open_flags_document_id_status_idx"
  ON "document_brief_open_flags" ("document_id", "status");
