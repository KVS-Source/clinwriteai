-- What a source document is for, per document it is linked to:
--   evidence — this study's own material; facts may come from it
--   example  — a sample or another study's document; used for structure and wording only
-- A file can be evidence for one document and an example for another, so the role lives on
-- the link, not the upload. Existing links stay 'evidence' (how they were used until now).
-- Rollback = DROP COLUMN.

ALTER TABLE "document_sources"
  ADD COLUMN "role" TEXT NOT NULL DEFAULT 'evidence';
