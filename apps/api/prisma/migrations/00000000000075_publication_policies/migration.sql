-- Phase M-B.1 of the Scientific-Writing parity work.
-- Mirrors Module A's DocumentTypePolicy + AiPromptRecord +
-- BestPracticeRecord + DocumentTemplate + ChecklistTemplate shape
-- for publications. Flat doctype slugs (manuscript_full_research,
-- manuscript_review_systematic, abstract, poster, letter, pls, …).

-- ----- publication_type_policies -----------------------------------------
CREATE TABLE "publication_type_policies" (
  "id"                  TEXT        PRIMARY KEY,
  "docType"             TEXT        NOT NULL,
  "version"             INTEGER     NOT NULL,
  "isCurrent"           BOOLEAN     NOT NULL DEFAULT true,
  "templateId"          TEXT,
  "checklistTemplateId" TEXT,
  "guidelineKey"        TEXT,
  "smePrompt"           TEXT        NOT NULL DEFAULT '',
  "bestPracticeDigest"  JSONB       NOT NULL DEFAULT '{"principles":[]}',
  "sectionRules"        JSONB       NOT NULL DEFAULT '{}',
  "effectiveDate"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "retiredAt"           TIMESTAMP(3),
  "retiredBy"           TEXT,
  "retireReason"        TEXT,
  "supersededBy"        TEXT,
  "createdBy"           TEXT        NOT NULL,
  "updatedBy"           TEXT        NOT NULL,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "publication_type_policies_docType_version_key"
  ON "publication_type_policies"("docType", "version");
CREATE INDEX "publication_type_policies_docType_isCurrent_idx"
  ON "publication_type_policies"("docType", "isCurrent");

-- ----- publication_ai_prompt_records --------------------------------------
CREATE TABLE "publication_ai_prompt_records" (
  "id"             TEXT        PRIMARY KEY,
  "docType"        TEXT        NOT NULL,
  "version"        INTEGER     NOT NULL,
  "status"         TEXT        NOT NULL DEFAULT 'draft',
  "smePrompt"      TEXT        NOT NULL,
  "sectionRules"   JSONB       NOT NULL DEFAULT '{}',
  "supersededBy"   TEXT,
  "effectiveDate"  TIMESTAMP(3),
  "retiredAt"      TIMESTAMP(3),
  "retireReason"   TEXT,
  "approvedBy"     TEXT,
  "approvedAt"     TIMESTAMP(3),
  "createdBy"      TEXT        NOT NULL,
  "updatedBy"      TEXT        NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "publication_ai_prompt_records_docType_version_key"
  ON "publication_ai_prompt_records"("docType", "version");
CREATE INDEX "publication_ai_prompt_records_docType_status_idx"
  ON "publication_ai_prompt_records"("docType", "status");
CREATE INDEX "publication_ai_prompt_records_status_idx"
  ON "publication_ai_prompt_records"("status");

-- ----- publication_best_practice_records ----------------------------------
CREATE TABLE "publication_best_practice_records" (
  "id"             TEXT        PRIMARY KEY,
  "docType"        TEXT        NOT NULL,
  "version"        INTEGER     NOT NULL,
  "status"         TEXT        NOT NULL DEFAULT 'draft',
  "digest"         JSONB       NOT NULL DEFAULT '{"principles":[]}',
  "sourcePdfId"    TEXT,
  "distilledAt"    TIMESTAMP(3),
  "distilledModel" TEXT,
  "supersededBy"   TEXT,
  "effectiveDate"  TIMESTAMP(3),
  "retiredAt"      TIMESTAMP(3),
  "retireReason"   TEXT,
  "approvedBy"     TEXT,
  "approvedAt"     TIMESTAMP(3),
  "createdBy"      TEXT        NOT NULL,
  "updatedBy"      TEXT        NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "publication_best_practice_records_docType_version_key"
  ON "publication_best_practice_records"("docType", "version");
CREATE INDEX "publication_best_practice_records_docType_status_idx"
  ON "publication_best_practice_records"("docType", "status");
CREATE INDEX "publication_best_practice_records_status_idx"
  ON "publication_best_practice_records"("status");

-- ----- publication_templates ----------------------------------------------
CREATE TABLE "publication_templates" (
  "id"          TEXT        PRIMARY KEY,
  "docType"     TEXT        NOT NULL,
  "version"     INTEGER     NOT NULL DEFAULT 1,
  "isCurrent"   BOOLEAN     NOT NULL DEFAULT true,
  "label"       TEXT        NOT NULL,
  "description" TEXT        NOT NULL DEFAULT '',
  "sections"    JSONB       NOT NULL DEFAULT '[]',
  "retiredAt"   TIMESTAMP(3),
  "retiredBy"   TEXT,
  "createdBy"   TEXT        NOT NULL,
  "updatedBy"   TEXT        NOT NULL,
  "createdAt"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"   TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "publication_templates_docType_version_key"
  ON "publication_templates"("docType", "version");
CREATE INDEX "publication_templates_docType_isCurrent_idx"
  ON "publication_templates"("docType", "isCurrent");

-- ----- publication_checklist_templates ------------------------------------
CREATE TABLE "publication_checklist_templates" (
  "id"         TEXT        PRIMARY KEY,
  "docType"    TEXT        NOT NULL,
  "version"    INTEGER     NOT NULL DEFAULT 1,
  "isCurrent"  BOOLEAN     NOT NULL DEFAULT true,
  "items"      JSONB       NOT NULL DEFAULT '[]',
  "retiredAt"  TIMESTAMP(3),
  "retiredBy"  TEXT,
  "createdBy"  TEXT        NOT NULL,
  "updatedBy"  TEXT        NOT NULL,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"  TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX "publication_checklist_templates_docType_version_key"
  ON "publication_checklist_templates"("docType", "version");
CREATE INDEX "publication_checklist_templates_docType_isCurrent_idx"
  ON "publication_checklist_templates"("docType", "isCurrent");

-- ----- publications pin columns -------------------------------------------
-- Mirror of Module A documents.policy_version_at_create /
-- ai_prompt_record_id / best_practice_record_id. Nullable — populated
-- on new publication creates in Phase M-B.2+. Existing rows stay null;
-- the resolver (built in Phase M-B.4) falls back to the current
-- approved record, same as clinical writing.
ALTER TABLE "publications"
  ADD COLUMN "pub_type_policy_version_at_create"            INTEGER,
  ADD COLUMN "publication_ai_prompt_record_id"              TEXT,
  ADD COLUMN "publication_ai_prompt_version_at_create"      INTEGER,
  ADD COLUMN "publication_best_practice_record_id"          TEXT,
  ADD COLUMN "publication_best_practice_version_at_create"  INTEGER;

CREATE INDEX "publications_publication_ai_prompt_record_id_idx"
  ON "publications"("publication_ai_prompt_record_id");
CREATE INDEX "publications_publication_best_practice_record_id_idx"
  ON "publications"("publication_best_practice_record_id");
