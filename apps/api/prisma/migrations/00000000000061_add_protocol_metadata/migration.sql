-- DRAFT — do not apply blindly. Run `prisma migrate deploy` separately.
--
-- Protocol metadata on Document (Clinical Trial Protocol + Protocol
-- Amendment). The "Protocol" right-hand panel in the editor + the home
-- row-menu captures these fields. Everything is nullable: the panel is a
-- progressive-disclosure form and empty is the baseline — a document can
-- be created without any of them set, and each field saves onBlur.
--
-- Columns (every one TEXT; Prisma defaults String → TEXT on Postgres):
--   study_title               Study title (free text, usually a sentence)
--   protocol_number           House-assigned ID (e.g. "GB-NSCLC-002")
--   protocol_version          Version label ("v3.1", "Amendment 2", …)
--   sponsor                   Legal sponsor name
--   investigational_product   Compound / device under study
--   study_design              Longer free-text design summary
--   target_population         Longer free-text inclusion / exclusion summary
--   regulatory_region         Lowercase enum string:
--                             'us' | 'eu' | 'india' | 'global' | 'other'
--                             Validated at the API edge; no DB CHECK yet
--                             (same pattern as document_status / stage,
--                             see ADR 0001).
--
-- All fields are visible to any user who can read the document; only an
-- assignee / holder of R/A/Q RACI letter + admin can mutate them, gated
-- at the Fastify route (apps/api/.../documents/routes.ts). Signed +
-- in-review + pending-signature documents return 409 document_locked
-- (reuses authoringLockReason — same rule as section content).
--
-- No index — the fields are read with the rest of the row via the
-- documents detail route, never filtered on. Add one later if the
-- listing screen ever needs "all documents with protocolNumber = X".

ALTER TABLE "documents"
  ADD COLUMN "study_title"              TEXT,
  ADD COLUMN "protocol_number"          TEXT,
  ADD COLUMN "protocol_version"         TEXT,
  ADD COLUMN "sponsor"                  TEXT,
  ADD COLUMN "investigational_product"  TEXT,
  ADD COLUMN "study_design"             TEXT,
  ADD COLUMN "target_population"        TEXT,
  ADD COLUMN "regulatory_region"        TEXT;
