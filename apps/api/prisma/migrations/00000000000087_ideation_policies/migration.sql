-- Phase M-E.1 — ideation-publishing policy stack.
-- Mirror of regulatory_type_policies scoped to the ideation artefact
-- doctypes (kol_engagement_brief, patient_story, hcp_insight_report,
-- medical_affairs_narrative, etc.). The pin columns on
-- ideation_artefacts land here too since the table exists already.

-- ----- ideation_type_policies --------------------------------------------
CREATE TABLE "ideation_type_policies" (
  "id"                  TEXT        PRIMARY KEY,
  "docType"             TEXT        NOT NULL,
  "version"             INTEGER     NOT NULL,
  "isCurrent"           BOOLEAN     NOT NULL DEFAULT true,
  "templateId"          TEXT,
  "checklistTemplateId" TEXT,
  "channelHint"         TEXT,
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
CREATE UNIQUE INDEX "ideation_type_policies_docType_version_key"
  ON "ideation_type_policies"("docType", "version");
CREATE INDEX "ideation_type_policies_docType_isCurrent_idx"
  ON "ideation_type_policies"("docType", "isCurrent");

-- ----- ideation_ai_prompt_records ----------------------------------------
CREATE TABLE "ideation_ai_prompt_records" (
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
CREATE UNIQUE INDEX "ideation_ai_prompt_records_docType_version_key"
  ON "ideation_ai_prompt_records"("docType", "version");
CREATE INDEX "ideation_ai_prompt_records_docType_status_idx"
  ON "ideation_ai_prompt_records"("docType", "status");
CREATE INDEX "ideation_ai_prompt_records_status_idx"
  ON "ideation_ai_prompt_records"("status");

-- ----- ideation_best_practice_records ------------------------------------
CREATE TABLE "ideation_best_practice_records" (
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
CREATE UNIQUE INDEX "ideation_best_practice_records_docType_version_key"
  ON "ideation_best_practice_records"("docType", "version");
CREATE INDEX "ideation_best_practice_records_docType_status_idx"
  ON "ideation_best_practice_records"("docType", "status");
CREATE INDEX "ideation_best_practice_records_status_idx"
  ON "ideation_best_practice_records"("status");

-- ----- ideation_artefact_templates ---------------------------------------
CREATE TABLE "ideation_artefact_templates" (
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
CREATE UNIQUE INDEX "ideation_artefact_templates_docType_version_key"
  ON "ideation_artefact_templates"("docType", "version");
CREATE INDEX "ideation_artefact_templates_docType_isCurrent_idx"
  ON "ideation_artefact_templates"("docType", "isCurrent");

-- ----- ideation_artefact_checklist_templates ------------------------------
CREATE TABLE "ideation_artefact_checklist_templates" (
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
CREATE UNIQUE INDEX "ideation_artefact_checklist_templates_docType_version_key"
  ON "ideation_artefact_checklist_templates"("docType", "version");
CREATE INDEX "ideation_artefact_checklist_templates_docType_isCurrent_idx"
  ON "ideation_artefact_checklist_templates"("docType", "isCurrent");

-- ----- ideation_artefacts pin columns -------------------------------------
ALTER TABLE "ideation_artefacts"
  ADD COLUMN "doc_type"                            TEXT,
  ADD COLUMN "ideation_type_policy_version_at_create"      INTEGER,
  ADD COLUMN "ideation_ai_prompt_record_id"                TEXT,
  ADD COLUMN "ideation_ai_prompt_version_at_create"        INTEGER,
  ADD COLUMN "ideation_best_practice_record_id"            TEXT,
  ADD COLUMN "ideation_best_practice_version_at_create"    INTEGER;

CREATE INDEX "ideation_artefacts_doc_type_idx"
  ON "ideation_artefacts"("doc_type");
CREATE INDEX "ideation_artefacts_ideation_ai_prompt_record_id_idx"
  ON "ideation_artefacts"("ideation_ai_prompt_record_id");
CREATE INDEX "ideation_artefacts_ideation_best_practice_record_id_idx"
  ON "ideation_artefacts"("ideation_best_practice_record_id");
