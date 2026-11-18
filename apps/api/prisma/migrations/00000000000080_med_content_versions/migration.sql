-- Phase M-C.2 — med content versioning + sections + section locks +
-- slide locks. Mirror of publications + clinical patterns scoped to
-- medical content. Single-body types seed a synthetic 'body' section.

CREATE TABLE "med_content_versions" (
  "id"              TEXT        PRIMARY KEY,
  "contentItemId"   TEXT        NOT NULL,
  "versionNumber"   TEXT        NOT NULL,
  "label"           TEXT        NOT NULL,
  "contentHash"     TEXT        NOT NULL,
  "isCurrent"       BOOLEAN     NOT NULL DEFAULT true,
  "createdBy"       TEXT        NOT NULL,
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "restoreSource"   JSONB,
  CONSTRAINT "med_content_versions_contentItemId_fkey"
    FOREIGN KEY ("contentItemId") REFERENCES "med_content_items"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "med_content_versions_contentItemId_versionNumber_key"
  ON "med_content_versions"("contentItemId", "versionNumber");
CREATE INDEX "med_content_versions_contentItemId_idx"
  ON "med_content_versions"("contentItemId");

CREATE TABLE "med_content_sections" (
  "id"                   TEXT        PRIMARY KEY,
  "medContentVersionId"  TEXT        NOT NULL,
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
  CONSTRAINT "med_content_sections_medContentVersionId_fkey"
    FOREIGN KEY ("medContentVersionId") REFERENCES "med_content_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE UNIQUE INDEX "med_content_sections_medContentVersionId_sectionId_key"
  ON "med_content_sections"("medContentVersionId", "sectionId");
CREATE INDEX "med_content_sections_medContentVersionId_idx"
  ON "med_content_sections"("medContentVersionId");

CREATE TABLE "med_content_section_locks" (
  "id"              TEXT        PRIMARY KEY,
  "contentItemId"   TEXT        NOT NULL,
  "sectionId"       TEXT        NOT NULL,
  "userId"          TEXT        NOT NULL,
  "acquiredAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastHeartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "med_content_section_locks_contentItemId_sectionId_key"
  ON "med_content_section_locks"("contentItemId", "sectionId");
CREATE INDEX "med_content_section_locks_userId_idx"
  ON "med_content_section_locks"("userId");
CREATE INDEX "med_content_section_locks_lastHeartbeatAt_idx"
  ON "med_content_section_locks"("lastHeartbeatAt");

CREATE TABLE "med_slide_locks" (
  "id"              TEXT        PRIMARY KEY,
  "slideId"         TEXT        NOT NULL,
  "userId"          TEXT        NOT NULL,
  "acquiredAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastHeartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "med_slide_locks_slideId_key"
  ON "med_slide_locks"("slideId");
CREATE INDEX "med_slide_locks_userId_idx"
  ON "med_slide_locks"("userId");
CREATE INDEX "med_slide_locks_lastHeartbeatAt_idx"
  ON "med_slide_locks"("lastHeartbeatAt");

-- ----- med_content_items.current_version_id -----------------------------
ALTER TABLE "med_content_items" ADD COLUMN "current_version_id" TEXT;
CREATE UNIQUE INDEX "med_content_items_current_version_id_key"
  ON "med_content_items"("current_version_id");
ALTER TABLE "med_content_items"
  ADD CONSTRAINT "med_content_items_current_version_id_fkey"
  FOREIGN KEY ("current_version_id") REFERENCES "med_content_versions"("id")
  ON DELETE NO ACTION ON UPDATE NO ACTION;
