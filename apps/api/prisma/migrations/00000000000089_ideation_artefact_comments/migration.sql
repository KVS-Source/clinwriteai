-- Phase M-E.5 — threaded comments on ideation artefact sections.
-- Mirror of regulatory_document_section_comments.

CREATE TABLE "ideation_artefact_section_comments" (
  "id"                   TEXT        PRIMARY KEY,
  "ideationArtefactId"   TEXT        NOT NULL,
  "sectionId"            TEXT        NOT NULL,
  "authorId"             TEXT        NOT NULL,
  "authorName"           TEXT        NOT NULL,
  "text"                 TEXT        NOT NULL,
  "severity"             TEXT        NOT NULL DEFAULT 'info',
  "status"               TEXT        NOT NULL DEFAULT 'open',
  "resolvedBy"           TEXT,
  "resolvedAt"           TIMESTAMP(3),
  "resolutionNote"       TEXT,
  "parentCommentId"      TEXT,
  "mentionedUserIds"     TEXT[]      NOT NULL DEFAULT ARRAY[]::TEXT[],
  "createdAt"            TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "ideation_artefact_section_comments_artefactId_idx"
  ON "ideation_artefact_section_comments"("ideationArtefactId");
CREATE INDEX "ideation_artefact_section_comments_artefactId_sectionId_idx"
  ON "ideation_artefact_section_comments"("ideationArtefactId", "sectionId");
CREATE INDEX "ideation_artefact_section_comments_parentCommentId_idx"
  ON "ideation_artefact_section_comments"("parentCommentId");
