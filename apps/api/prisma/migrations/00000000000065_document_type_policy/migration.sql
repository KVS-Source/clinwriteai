-- DocumentTypePolicy + Document.policy_version_at_create (2026-11-10).
--
-- One row per doc type holds the SME prompt + best-practice digest +
-- template + checklist + ICH framework + per-section rule overrides.
-- Versioning model matches ChecklistTemplate: isCurrent=true marks the
-- live row per docType; a new version flips the old to isCurrent=false
-- + supersededBy set to the new row's id.
--
-- Document.policy_version_at_create snapshots which policy version
-- authored the document; null for documents created before migration 65.
--
-- Columns:
--   sme_prompt           TEXT  — SME-authored base prompt (long text)
--   best_practice_digest JSONB — see platform/document-type-policy/schema.ts
--                                for the Zod shape (principles[], distilled
--                                metadata)
--   section_rules        JSONB — { <sectionKey>: [{severity, text}, ...] }
--   template_id          TEXT  — loose FK to document_templates.id
--                                (not a Prisma relation — template cascade
--                                would retire policies on template retirement,
--                                which is wrong; we want policies to pin to
--                                a specific template version)
--   checklist_template_id TEXT — loose FK to checklist_templates.id
--   ich_framework        TEXT  — 'ICH E3' | 'ICH M11' | 'ICH E6(R3)' | ...

CREATE TABLE "document_type_policies" (
  "id"                    TEXT         PRIMARY KEY,
  "docType"               TEXT         NOT NULL,
  "version"               INTEGER      NOT NULL DEFAULT 1,
  "isCurrent"             BOOLEAN      NOT NULL DEFAULT TRUE,

  "smePrompt"             TEXT         NOT NULL,
  "bestPracticeDigest"    JSONB        NOT NULL DEFAULT '{}',
  "sectionRules"          JSONB        NOT NULL DEFAULT '{}',

  "templateId"            TEXT,
  "checklistTemplateId"   TEXT,
  "ichFramework"          TEXT,

  "effectiveDate"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "supersededBy"          TEXT,
  "retiredAt"             TIMESTAMP(3),
  "retiredBy"             TEXT,
  "retireReason"          TEXT,

  "createdBy"             TEXT         NOT NULL,
  "updatedBy"             TEXT         NOT NULL,
  "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"             TIMESTAMP(3) NOT NULL
);

CREATE UNIQUE INDEX "document_type_policies_docType_version_key"
  ON "document_type_policies" ("docType", "version");

CREATE INDEX "document_type_policies_docType_isCurrent_idx"
  ON "document_type_policies" ("docType", "isCurrent");

-- Snapshot column on documents.
ALTER TABLE "documents"
  ADD COLUMN "policy_version_at_create" INTEGER;
