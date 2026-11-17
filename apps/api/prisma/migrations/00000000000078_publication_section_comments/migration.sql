-- Phase M-B.5 — threaded comments per publication section.
-- Mirror of Module A's comments scoped to publications.

CREATE TABLE "publication_section_comments" (
  "id"               TEXT        PRIMARY KEY,
  "publicationId"    TEXT        NOT NULL,
  "sectionId"        TEXT        NOT NULL,
  "authorId"         TEXT        NOT NULL,
  "authorName"       TEXT        NOT NULL,
  "text"             TEXT        NOT NULL,
  "severity"         TEXT        NOT NULL DEFAULT 'info',
  "status"           TEXT        NOT NULL DEFAULT 'open',
  "resolvedBy"       TEXT,
  "resolvedAt"       TIMESTAMP(3),
  "resolutionNote"   TEXT,
  "parentCommentId"  TEXT,
  "mentionedUserIds" TEXT[]      NOT NULL DEFAULT ARRAY[]::TEXT[],
  "createdAt"        TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "publication_section_comments_publicationId_idx"
  ON "publication_section_comments"("publicationId");
CREATE INDEX "publication_section_comments_publicationId_sectionId_idx"
  ON "publication_section_comments"("publicationId", "sectionId");
CREATE INDEX "publication_section_comments_parentCommentId_idx"
  ON "publication_section_comments"("parentCommentId");
