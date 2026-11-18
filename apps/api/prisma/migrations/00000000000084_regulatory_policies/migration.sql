-- Phase M-D.1 — regulatory-writing policy stack.
-- Mirror of med_content_* policy tables, scoped to the long-form
-- regulatory narrative documents authored inside a RegulatorySubmission
-- (CTD Module 2 overviews, Quality Overall Summary, HA responses, etc.).
-- The pin columns on regulatory_documents are added in migration 85
-- (M-D.2) alongside the regulatory_documents table itself.

-- ----- regulatory_type_policies ------------------------------------------
CREATE TABLE "regulatory_type_policies" (
  "id"                  TEXT        PRIMARY KEY,
  "docType"             TEXT        NOT NULL,
  "version"             INTEGER     NOT NULL,
  "isCurrent"           BOOLEAN     NOT NULL DEFAULT true,
  "templateId"          TEXT,
  "checklistTemplateId" TEXT,
  "regulatoryTrack"     TEXT,
  "reviewTierFormula"   TEXT,
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
CREATE UNIQUE INDEX "regulatory_type_policies_docType_version_key"
  ON "regulatory_type_policies"("docType", "version");
CREATE INDEX "regulatory_type_policies_docType_isCurrent_idx"
  ON "regulatory_type_policies"("docType", "isCurrent");

-- ----- regulatory_ai_prompt_records --------------------------------------
CREATE TABLE "regulatory_ai_prompt_records" (
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
CREATE UNIQUE INDEX "regulatory_ai_prompt_records_docType_version_key"
  ON "regulatory_ai_prompt_records"("docType", "version");
CREATE INDEX "regulatory_ai_prompt_records_docType_status_idx"
  ON "regulatory_ai_prompt_records"("docType", "status");
CREATE INDEX "regulatory_ai_prompt_records_status_idx"
  ON "regulatory_ai_prompt_records"("status");

-- ----- regulatory_best_practice_records ----------------------------------
CREATE TABLE "regulatory_best_practice_records" (
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
CREATE UNIQUE INDEX "regulatory_best_practice_records_docType_version_key"
  ON "regulatory_best_practice_records"("docType", "version");
CREATE INDEX "regulatory_best_practice_records_docType_status_idx"
  ON "regulatory_best_practice_records"("docType", "status");
CREATE INDEX "regulatory_best_practice_records_status_idx"
  ON "regulatory_best_practice_records"("status");

-- ----- regulatory_document_templates --------------------------------------
CREATE TABLE "regulatory_document_templates" (
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
CREATE UNIQUE INDEX "regulatory_document_templates_docType_version_key"
  ON "regulatory_document_templates"("docType", "version");
CREATE INDEX "regulatory_document_templates_docType_isCurrent_idx"
  ON "regulatory_document_templates"("docType", "isCurrent");

-- ----- regulatory_document_checklist_templates ---------------------------
CREATE TABLE "regulatory_document_checklist_templates" (
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
CREATE UNIQUE INDEX "regulatory_document_checklist_templates_docType_version_key"
  ON "regulatory_document_checklist_templates"("docType", "version");
CREATE INDEX "regulatory_document_checklist_templates_docType_isCurrent_idx"
  ON "regulatory_document_checklist_templates"("docType", "isCurrent");
