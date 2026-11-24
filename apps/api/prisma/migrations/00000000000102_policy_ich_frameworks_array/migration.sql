-- Multi-value ICH framework pin on DocumentTypePolicy.
--
-- WHY:
--   Protocols reference several ICH guidelines at once (M11 for
--   harmonisation + E6 for GCP + E8 for study design); the single
--   `ich_framework String?` column forced the PM to pick one and lost
--   the rest. The AI prompt + Final-PDF appendix both want the full
--   list to cite.
--
-- Shape: TEXT[] of framework names (matching RegulatoryFramework.name,
-- e.g. 'ICH M11'). Defaults to empty so the auto-match convention map
-- (DOC_TYPE_TO_ICH) stays the fallback when the PM hasn't pinned
-- anything.
--
-- Backfill: existing rows with a non-null `ich_framework` get a
-- one-element array. The old column is NOT dropped in this migration —
-- a follow-up cleanup drops it once the code has been live for a
-- release and nothing reads it anymore.

ALTER TABLE "document_type_policies"
  ADD COLUMN "ich_framework_names" TEXT[] NOT NULL DEFAULT '{}';

UPDATE "document_type_policies"
   SET "ich_framework_names" = ARRAY["ichFramework"]
 WHERE "ichFramework" IS NOT NULL AND "ichFramework" <> '';
