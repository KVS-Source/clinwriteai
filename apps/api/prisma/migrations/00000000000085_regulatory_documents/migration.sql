-- Phase M-D.2 — regulatory documents + versioning + sections + locks.
-- Creates the primary writable entity for regulatory narrative
-- documents (CTD Module 2 overviews, QOS, cover letter, HA response
-- narrative, risk-benefit statement) authored inside a submission.
--
-- A RegulatorySubmission is the envelope (eCTD nodes + canonical
-- entries + CMC report + ODD + HA correspondence). A RegulatoryDocument
-- is a long-form narrative document authored inside that envelope.
-- Multiple documents per submission.

CREATE TABLE "regulatory_documents" (
  "id"                                       TEXT        PRIMARY KEY,
  "submissionId"                             TEXT        NOT NULL,
  "projectId"                                TEXT        NOT NULL,
  "docType"                                  TEXT        NOT NULL,
  "title"                                    TEXT        NOT NULL,
  "status"                                   TEXT        NOT NULL DEFAULT 'drafting',
  "stage"                                    INTEGER     NOT NULL DEFAULT 1,
  "regulatoryTrack"                          TEXT,
  "version"                                  TEXT        NOT NULL DEFAULT 'v0.1',

  -- Pointer-refactor pins (M-D.1 policy tables).
  "reg_type_policy_version_at_create"        INTEGER,
  "reg_ai_prompt_record_id"                  TEXT,
  "reg_ai_prompt_version_at_create"          INTEGER,
  "reg_best_practice_record_id"              TEXT,
  "reg_best_practice_version_at_create"      INTEGER,

  -- AI draft state (same shape as pub + med).
  "ai_draft_state_d"                         TEXT        NOT NULL DEFAULT 'idle',
  "ai_instructions_d"                        TEXT,

  "ownerId"                                  TEXT        NOT NULL,
  "createdBy"                                TEXT        NOT NULL,
  "createdAt"                                TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"                                TIMESTAMP(3) NOT NULL,
  "archivedAt"                               TIMESTAMP(3),
  "archiveReason"                            TEXT,

  "current_version_id"                       TEXT,
  CONSTRAINT "regulatory_documents_submissionId_fkey"
    FOREIGN KEY ("submissionId") REFERENCES "regulatory_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "regulatory_documents_submissionId_idx" ON "regulatory_documents"("submissionId");
CREATE INDEX "regulatory_documents_projectId_idx" ON "regulatory_documents"("projectId");
CREATE INDEX "regulatory_documents_docType_idx" ON "regulatory_documents"("docType");
CREATE INDEX "regulatory_documents_status_idx" ON "regulatory_documents"("status");
CREATE INDEX "regulatory_documents_reg_ai_prompt_record_id_idx"
  ON "regulatory_documents"("reg_ai_prompt_record_id");
CREATE INDEX "regulatory_documents_reg_best_practice_record_id_idx"
  ON "regulatory_documents"("reg_best_practice_record_id");

CREATE TABLE "regulatory_document_versions" (
  "id"                   TEXT        PRIMARY KEY,
  "regulatoryDocumentId" TEXT        NOT NULL,
  "versionNumber"        TEXT        NOT NULL,
  "label"                TEXT        NOT NULL,
  "contentHash"          TEXT        NOT NULL,
  "isCurrent"            BOOLEAN     NOT NULL DEFAULT true,
  "createdBy"            TEXT        NOT NULL,
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "restoreSource"        JSONB,
  CONSTRAINT "regulatory_document_versions_regulatoryDocumentId_fkey"
    FOREIGN KEY ("regulatoryDocumentId") REFERENCES "regulatory_documents"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "regulatory_document_versions_regDoc_versionNumber_key"
  ON "regulatory_document_versions"("regulatoryDocumentId", "versionNumber");
CREATE INDEX "regulatory_document_versions_regulatoryDocumentId_idx"
  ON "regulatory_document_versions"("regulatoryDocumentId");

CREATE TABLE "regulatory_document_sections" (
  "id"                           TEXT        PRIMARY KEY,
  "regulatoryDocumentVersionId"  TEXT        NOT NULL,
  "sectionId"                    TEXT        NOT NULL,
  "sectionNumber"                TEXT        NOT NULL,
  "sectionTitle"                 TEXT        NOT NULL,
  "contentHtml"                  TEXT        NOT NULL DEFAULT '',
  "wordCount"                    INTEGER     NOT NULL DEFAULT 0,
  "aiSpanCount"                  INTEGER     NOT NULL DEFAULT 0,
  "humanSpanCount"               INTEGER     NOT NULL DEFAULT 0,
  "lastEditedBy"                 TEXT,
  "lastEditedAt"                 TIMESTAMP(3),
  "ai_confidence"                INTEGER,
  "ai_flags"                     TEXT[]      NOT NULL DEFAULT ARRAY[]::TEXT[],
  CONSTRAINT "regulatory_document_sections_regDocVersionId_fkey"
    FOREIGN KEY ("regulatoryDocumentVersionId") REFERENCES "regulatory_document_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "regulatory_document_sections_regDocVersionId_sectionId_key"
  ON "regulatory_document_sections"("regulatoryDocumentVersionId", "sectionId");
CREATE INDEX "regulatory_document_sections_regDocVersionId_idx"
  ON "regulatory_document_sections"("regulatoryDocumentVersionId");

CREATE TABLE "regulatory_document_section_locks" (
  "id"                  TEXT        PRIMARY KEY,
  "regulatoryDocumentId" TEXT       NOT NULL,
  "sectionId"           TEXT        NOT NULL,
  "userId"              TEXT        NOT NULL,
  "acquiredAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastHeartbeatAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "regulatory_document_section_locks_regDocId_sectionId_key"
  ON "regulatory_document_section_locks"("regulatoryDocumentId", "sectionId");
CREATE INDEX "regulatory_document_section_locks_userId_idx"
  ON "regulatory_document_section_locks"("userId");
CREATE INDEX "regulatory_document_section_locks_lastHeartbeatAt_idx"
  ON "regulatory_document_section_locks"("lastHeartbeatAt");

-- Wire the current_version_id FK after both tables exist.
ALTER TABLE "regulatory_documents"
  ADD CONSTRAINT "regulatory_documents_current_version_id_fkey"
  FOREIGN KEY ("current_version_id") REFERENCES "regulatory_document_versions"("id")
  ON DELETE NO ACTION ON UPDATE NO ACTION;
CREATE UNIQUE INDEX "regulatory_documents_current_version_id_key"
  ON "regulatory_documents"("current_version_id");
