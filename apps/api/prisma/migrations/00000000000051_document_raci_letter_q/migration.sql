-- Expand document_raci.letter CHECK to include 'Q' (Quality Control).
--
-- Per docs/roles-and-permissions.md §4: QC is now a first-class RACI letter
-- parallel to C — both cohorts (scientific review + QC release) must
-- complete before approval. 'Q' rows use the existing `reviewedAt` column
-- for completion; the `letter` column distinguishes C and Q in the audit
-- trail.
--
-- Drop + recreate rather than ALTER CHECK — Postgres doesn't support
-- modifying a CHECK constraint in place; the alternative is NOT VALID +
-- VALIDATE which adds no safety on an empty table.

ALTER TABLE "document_raci" DROP CONSTRAINT "document_raci_letter_check";
ALTER TABLE "document_raci"
  ADD CONSTRAINT "document_raci_letter_check"
  CHECK ("letter" IN ('R', 'A', 'C', 'I', 'Q'));
