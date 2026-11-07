-- Document Brief — compact derived summary of a document (2026-11-06).
--
-- One row per Document, regenerated on structural events (section
-- add/rename, protocol-metadata edit, source link/unlink, reference
-- add) by the brief service. Users do not edit this directly.
--
-- Carried on every AI section-rewrite call so the model has enough
-- context (outline, cross-ref inventory, next citation number,
-- jurisdiction + sponsor rules) without re-sending the full document
-- body. Target: ≤ ~1.5k tokens when stringified.
--
-- Columns:
--   document_id    — one-to-one FK to documents.id (cascade delete; a
--                    deleted document loses its brief).
--   rev            — monotonic counter bumped on each regen; downstream
--                    caches key off (document_id, rev).
--   content_json   — the brief itself, validated by Zod briefSchema at
--                    the API edge (document-brief/schema.ts).
--   generated_at   — timestamp of the most recent regen.
--
-- No status column — a stale brief is just recomputed; there is no
-- 'dirty' state to query.

CREATE TABLE "document_briefs" (
  "id"            TEXT        PRIMARY KEY,
  "document_id"   TEXT        NOT NULL UNIQUE,
  "rev"           INTEGER     NOT NULL DEFAULT 0,
  "content_json"  JSONB       NOT NULL DEFAULT '{}',
  "generated_at"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_at"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"    TIMESTAMP(3) NOT NULL,

  CONSTRAINT "document_briefs_document_id_fkey"
    FOREIGN KEY ("document_id")
    REFERENCES "documents" ("id")
    ON DELETE CASCADE
    ON UPDATE CASCADE
);
