-- Phase M-B.2 — publication versioning + persisted sections + section locks.
-- Mirror of Module A's document_versions / section_contents / section_locks
-- scoped to publications.

-- ----- publication_versions ----------------------------------------------
CREATE TABLE "publication_versions" (
  "id"             TEXT        PRIMARY KEY,
  "publicationId"  TEXT        NOT NULL,
  "versionNumber"  TEXT        NOT NULL,
  "label"          TEXT        NOT NULL,
  "contentHash"    TEXT        NOT NULL,
  "isCurrent"      BOOLEAN     NOT NULL DEFAULT true,
  "createdBy"      TEXT        NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "restoreSource"  JSONB,
  CONSTRAINT "publication_versions_publicationId_fkey"
    FOREIGN KEY ("publicationId") REFERENCES "publications"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "publication_versions_publicationId_versionNumber_key"
  ON "publication_versions"("publicationId", "versionNumber");
CREATE INDEX "publication_versions_publicationId_idx"
  ON "publication_versions"("publicationId");

-- ----- publication_section_contents --------------------------------------
CREATE TABLE "publication_section_contents" (
  "id"                   TEXT        PRIMARY KEY,
  "publicationVersionId" TEXT        NOT NULL,
  "sectionId"            TEXT        NOT NULL,
  "sectionNumber"        TEXT        NOT NULL,
  "sectionTitle"         TEXT        NOT NULL,
  "contentHtml"          TEXT        NOT NULL DEFAULT '',
  "wordCount"            INTEGER     NOT NULL DEFAULT 0,
  "aiSpanCount"          INTEGER     NOT NULL DEFAULT 0,
  "humanSpanCount"       INTEGER     NOT NULL DEFAULT 0,
  "lastEditedBy"         TEXT,
  "lastEditedAt"         TIMESTAMP(3),
  "ai_confidence"        INTEGER,
  "ai_flags"             TEXT[]      NOT NULL DEFAULT ARRAY[]::TEXT[],
  CONSTRAINT "publication_section_contents_publicationVersionId_fkey"
    FOREIGN KEY ("publicationVersionId") REFERENCES "publication_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "publication_section_contents_publicationVersionId_sectionId_key"
  ON "publication_section_contents"("publicationVersionId", "sectionId");
CREATE INDEX "publication_section_contents_publicationVersionId_idx"
  ON "publication_section_contents"("publicationVersionId");

-- ----- publication_section_locks -----------------------------------------
CREATE TABLE "publication_section_locks" (
  "id"              TEXT        PRIMARY KEY,
  "publicationId"   TEXT        NOT NULL,
  "sectionId"       TEXT        NOT NULL,
  "userId"          TEXT        NOT NULL,
  "acquiredAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastHeartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "publication_section_locks_publicationId_sectionId_key"
  ON "publication_section_locks"("publicationId", "sectionId");
CREATE INDEX "publication_section_locks_userId_idx"
  ON "publication_section_locks"("userId");
CREATE INDEX "publication_section_locks_lastHeartbeatAt_idx"
  ON "publication_section_locks"("lastHeartbeatAt");

-- ----- publications.current_version_id -----------------------------------
ALTER TABLE "publications" ADD COLUMN "current_version_id" TEXT;
CREATE UNIQUE INDEX "publications_current_version_id_key"
  ON "publications"("current_version_id");
ALTER TABLE "publications"
  ADD CONSTRAINT "publications_current_version_id_fkey"
  FOREIGN KEY ("current_version_id") REFERENCES "publication_versions"("id")
  ON DELETE NO ACTION ON UPDATE NO ACTION;
