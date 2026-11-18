-- Phase M-C.5 — threaded comments on med content sections + slides.
-- Mirror of publication_section_comments. Two tables because sections
-- live under MedContentVersion while slides live under MedSlideDeckJob
-- (no shared parent).

CREATE TABLE "med_content_section_comments" (
  "id"               TEXT        PRIMARY KEY,
  "contentItemId"    TEXT        NOT NULL,
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
CREATE INDEX "med_content_section_comments_contentItemId_idx"
  ON "med_content_section_comments"("contentItemId");
CREATE INDEX "med_content_section_comments_contentItemId_sectionId_idx"
  ON "med_content_section_comments"("contentItemId", "sectionId");
CREATE INDEX "med_content_section_comments_parentCommentId_idx"
  ON "med_content_section_comments"("parentCommentId");

CREATE TABLE "med_slide_comments" (
  "id"               TEXT        PRIMARY KEY,
  "slideId"          TEXT        NOT NULL,
  "deckJobId"        TEXT        NOT NULL,
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
CREATE INDEX "med_slide_comments_slideId_idx"
  ON "med_slide_comments"("slideId");
CREATE INDEX "med_slide_comments_deckJobId_idx"
  ON "med_slide_comments"("deckJobId");
CREATE INDEX "med_slide_comments_parentCommentId_idx"
  ON "med_slide_comments"("parentCommentId");
