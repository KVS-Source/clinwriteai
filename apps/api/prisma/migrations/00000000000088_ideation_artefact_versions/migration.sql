-- Phase M-E.2 — ideation artefact versioning + sections + section locks
-- + aiDraftState columns. Mirror of regulatory_document_versions.

ALTER TABLE "ideation_artefacts"
  ADD COLUMN "owner_id"              TEXT,
  ADD COLUMN "ai_draft_state_e"      TEXT NOT NULL DEFAULT 'idle',
  ADD COLUMN "ai_instructions_e"     TEXT,
  ADD COLUMN "current_version_id"    TEXT;

CREATE TABLE "ideation_artefact_versions" (
  "id"                   TEXT        PRIMARY KEY,
  "ideationArtefactId"   TEXT        NOT NULL,
  "versionNumber"        TEXT        NOT NULL,
  "label"                TEXT        NOT NULL,
  "contentHash"          TEXT        NOT NULL,
  "isCurrent"            BOOLEAN     NOT NULL DEFAULT true,
  "createdBy"            TEXT        NOT NULL,
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "restoreSource"        JSONB,
  CONSTRAINT "ideation_artefact_versions_ideationArtefactId_fkey"
    FOREIGN KEY ("ideationArtefactId") REFERENCES "ideation_artefacts"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ideation_artefact_versions_artefactId_versionNumber_key"
  ON "ideation_artefact_versions"("ideationArtefactId", "versionNumber");
CREATE INDEX "ideation_artefact_versions_ideationArtefactId_idx"
  ON "ideation_artefact_versions"("ideationArtefactId");

CREATE TABLE "ideation_artefact_sections" (
  "id"                            TEXT        PRIMARY KEY,
  "ideationArtefactVersionId"     TEXT        NOT NULL,
  "sectionId"                     TEXT        NOT NULL,
  "sectionNumber"                 TEXT        NOT NULL,
  "sectionTitle"                  TEXT        NOT NULL,
  "contentHtml"                   TEXT        NOT NULL DEFAULT '',
  "wordCount"                     INTEGER     NOT NULL DEFAULT 0,
  "aiSpanCount"                   INTEGER     NOT NULL DEFAULT 0,
  "humanSpanCount"                INTEGER     NOT NULL DEFAULT 0,
  "lastEditedBy"                  TEXT,
  "lastEditedAt"                  TIMESTAMP(3),
  "ai_confidence"                 INTEGER,
  "ai_flags"                      TEXT[]      NOT NULL DEFAULT ARRAY[]::TEXT[],
  CONSTRAINT "ideation_artefact_sections_versionId_fkey"
    FOREIGN KEY ("ideationArtefactVersionId") REFERENCES "ideation_artefact_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "ideation_artefact_sections_versionId_sectionId_key"
  ON "ideation_artefact_sections"("ideationArtefactVersionId", "sectionId");
CREATE INDEX "ideation_artefact_sections_versionId_idx"
  ON "ideation_artefact_sections"("ideationArtefactVersionId");

CREATE TABLE "ideation_artefact_section_locks" (
  "id"                  TEXT        PRIMARY KEY,
  "ideationArtefactId"  TEXT        NOT NULL,
  "sectionId"           TEXT        NOT NULL,
  "userId"              TEXT        NOT NULL,
  "acquiredAt"          TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastHeartbeatAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "ideation_artefact_section_locks_artefactId_sectionId_key"
  ON "ideation_artefact_section_locks"("ideationArtefactId", "sectionId");
CREATE INDEX "ideation_artefact_section_locks_userId_idx"
  ON "ideation_artefact_section_locks"("userId");
CREATE INDEX "ideation_artefact_section_locks_lastHeartbeatAt_idx"
  ON "ideation_artefact_section_locks"("lastHeartbeatAt");

ALTER TABLE "ideation_artefacts"
  ADD CONSTRAINT "ideation_artefacts_current_version_id_fkey"
  FOREIGN KEY ("current_version_id") REFERENCES "ideation_artefact_versions"("id")
  ON DELETE NO ACTION ON UPDATE NO ACTION;
CREATE UNIQUE INDEX "ideation_artefacts_current_version_id_key"
  ON "ideation_artefacts"("current_version_id");
