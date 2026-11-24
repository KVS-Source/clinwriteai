-- Policy requirements block.
--
-- WHY:
--   Clinical Writing's AI preflight checks hard-coded which inputs are
--   mandatory (sources, template, author instructions / purpose).
--   Different doc types have different realities — a 1-pager Advisory
--   Board summary genuinely doesn't need five source PDFs, a
--   Statistical Analysis Plan absolutely does. This migration lets a
--   PM toggle each requirement per doc type by storing a JSONB
--   `requirements` on the policy row.
--
-- Mapping:
--   - requireSources  → at least one usable PDF in `document_sources`
--   - requireTemplate → a document_template resolves (pinned or auto)
--   - requirePurpose  → the wizard's "Instructions for the AI drafter"
--                       field must be non-empty, i.e. the existing
--                       `documents.ai_instructions` column. No new
--                       column needed; the wizard field IS the purpose.
--
-- Defaults: all three require flags default to TRUE — the previous
-- hard-coded preflight always expected sources + template, and we are
-- now also treating purpose as required by default (PM can switch off
-- per doc type). Existing rows get the default via the DEFAULT clause.

ALTER TABLE "document_type_policies"
  ADD COLUMN "requirements" JSONB NOT NULL
    DEFAULT '{"requireSources": true, "requireTemplate": true, "requirePurpose": true}'::jsonb;
