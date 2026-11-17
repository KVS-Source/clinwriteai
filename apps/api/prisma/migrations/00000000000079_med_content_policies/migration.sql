-- Phase M-C.1 — medical-writing policy stack.
-- Mirror of Module B's publication_* policy tables scoped to the 7
-- medical content doctypes (hcp_slide_deck, mi_letter, pil, cme_module,
-- disease_dossier, eu_ctr_pls, advisory_report).

-- ----- med_content_type_policies -----------------------------------------
CREATE TABLE "med_content_type_policies" (
  "id"                  TEXT        PRIMARY KEY,
  "docType"             TEXT        NOT NULL,
  "version"             INTEGER     NOT NULL,
  "isCurrent"           BOOLEAN     NOT NULL DEFAULT true,
  "templateId"          TEXT,
  "checklistTemplateId" TEXT,
  "complianceTrack"     TEXT,
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
CREATE UNIQUE INDEX "med_content_type_policies_docType_version_key"
  ON "med_content_type_policies"("docType", "version");
CREATE INDEX "med_content_type_policies_docType_isCurrent_idx"
  ON "med_content_type_policies"("docType", "isCurrent");

-- ----- med_content_ai_prompt_records --------------------------------------
CREATE TABLE "med_content_ai_prompt_records" (
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
CREATE UNIQUE INDEX "med_content_ai_prompt_records_docType_version_key"
  ON "med_content_ai_prompt_records"("docType", "version");
CREATE INDEX "med_content_ai_prompt_records_docType_status_idx"
  ON "med_content_ai_prompt_records"("docType", "status");
CREATE INDEX "med_content_ai_prompt_records_status_idx"
  ON "med_content_ai_prompt_records"("status");

-- ----- med_content_best_practice_records ----------------------------------
CREATE TABLE "med_content_best_practice_records" (
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
CREATE UNIQUE INDEX "med_content_best_practice_records_docType_version_key"
  ON "med_content_best_practice_records"("docType", "version");
CREATE INDEX "med_content_best_practice_records_docType_status_idx"
  ON "med_content_best_practice_records"("docType", "status");
CREATE INDEX "med_content_best_practice_records_status_idx"
  ON "med_content_best_practice_records"("status");

-- ----- med_content_templates ----------------------------------------------
CREATE TABLE "med_content_templates" (
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
CREATE UNIQUE INDEX "med_content_templates_docType_version_key"
  ON "med_content_templates"("docType", "version");
CREATE INDEX "med_content_templates_docType_isCurrent_idx"
  ON "med_content_templates"("docType", "isCurrent");

-- ----- med_content_checklist_templates ------------------------------------
CREATE TABLE "med_content_checklist_templates" (
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
CREATE UNIQUE INDEX "med_content_checklist_templates_docType_version_key"
  ON "med_content_checklist_templates"("docType", "version");
CREATE INDEX "med_content_checklist_templates_docType_isCurrent_idx"
  ON "med_content_checklist_templates"("docType", "isCurrent");

-- ----- med_content_items pin columns --------------------------------------
-- Mirror of publications.publication_ai_prompt_record_id etc. Nullable;
-- populated by the create route when a policy / approved record exists.
ALTER TABLE "med_content_items"
  ADD COLUMN "med_content_type_policy_version_at_create"      INTEGER,
  ADD COLUMN "med_content_ai_prompt_record_id"                TEXT,
  ADD COLUMN "med_content_ai_prompt_version_at_create"        INTEGER,
  ADD COLUMN "med_content_best_practice_record_id"            TEXT,
  ADD COLUMN "med_content_best_practice_version_at_create"    INTEGER;

CREATE INDEX "med_content_items_med_content_ai_prompt_record_id_idx"
  ON "med_content_items"("med_content_ai_prompt_record_id");
CREATE INDEX "med_content_items_med_content_best_practice_record_id_idx"
  ON "med_content_items"("med_content_best_practice_record_id");
