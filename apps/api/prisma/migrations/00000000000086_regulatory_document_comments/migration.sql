-- Phase M-D.5 — threaded comments on regulatory document sections.
-- Mirror of med_content_section_comments.

CREATE TABLE "regulatory_document_section_comments" (
  "id"                    TEXT        PRIMARY KEY,
  "regulatoryDocumentId"  TEXT        NOT NULL,
  "sectionId"             TEXT        NOT NULL,
  "authorId"              TEXT        NOT NULL,
  "authorName"            TEXT        NOT NULL,
  "text"                  TEXT        NOT NULL,
  "severity"              TEXT        NOT NULL DEFAULT 'info',
  "status"                TEXT        NOT NULL DEFAULT 'open',
  "resolvedBy"            TEXT,
  "resolvedAt"            TIMESTAMP(3),
  "resolutionNote"        TEXT,
  "parentCommentId"       TEXT,
  "mentionedUserIds"      TEXT[]      NOT NULL DEFAULT ARRAY[]::TEXT[],
  "createdAt"             TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "regulatory_document_section_comments_regDocId_idx"
  ON "regulatory_document_section_comments"("regulatoryDocumentId");
CREATE INDEX "regulatory_document_section_comments_regDocId_sectionId_idx"
  ON "regulatory_document_section_comments"("regulatoryDocumentId", "sectionId");
CREATE INDEX "regulatory_document_section_comments_parentCommentId_idx"
  ON "regulatory_document_section_comments"("parentCommentId");
