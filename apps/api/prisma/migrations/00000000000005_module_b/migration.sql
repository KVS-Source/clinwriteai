-- Module B — Scientific Writing tables (docs/demo/02-datamodel.md §18-§23).
-- Generated via prisma migrate diff; audit_events DROP filtered per ADR 0002.


-- CreateTable
CREATE TABLE "publications" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "subtype" TEXT,
    "title" TEXT NOT NULL,
    "stage" TEXT NOT NULL DEFAULT 'planning',
    "status" TEXT NOT NULL DEFAULT 'not_started',
    "version" TEXT NOT NULL DEFAULT 'v0.1',
    "guideline" TEXT NOT NULL,
    "journal" TEXT,
    "targetSubmissionDate" TIMESTAMP(3),
    "keyMessage" TEXT,
    "baaStatus" TEXT NOT NULL DEFAULT 'not_applicable',
    "sourceDocumentId" TEXT,
    "sourceDocumentLabel" TEXT,
    "ownerId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "publications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_footprint_spans" (
    "id" TEXT NOT NULL,
    "publicationId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "startOffset" INTEGER NOT NULL,
    "endOffset" INTEGER NOT NULL,
    "model" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL,
    "acceptedBy" TEXT NOT NULL,
    "acceptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_footprint_spans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "citations" (
    "id" TEXT NOT NULL,
    "publicationId" TEXT NOT NULL,
    "pmid" TEXT,
    "title" TEXT NOT NULL,
    "shortRef" TEXT NOT NULL,
    "fullRef" TEXT NOT NULL,
    "locus" TEXT NOT NULL,
    "isSourceDocument" BOOLEAN NOT NULL DEFAULT false,
    "insertedBy" TEXT NOT NULL,
    "insertedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedBy" TEXT,
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "citations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publication_authors" (
    "id" TEXT NOT NULL,
    "publicationId" TEXT NOT NULL,
    "userId" TEXT,
    "name" TEXT NOT NULL,
    "initials" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "raci" TEXT NOT NULL,
    "isExternal" BOOLEAN NOT NULL DEFAULT false,
    "coiStatus" TEXT NOT NULL DEFAULT 'pending',
    "coiSubmittedAt" TIMESTAMP(3),
    "debarmentStatus" TEXT NOT NULL DEFAULT 'unchecked',
    "debarmentCheckedAt" TIMESTAMP(3),
    "invitedAt" TIMESTAMP(3),
    "inviteEmail" TEXT,
    "addedBy" TEXT NOT NULL,
    "addedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "removedAt" TIMESTAMP(3),

    CONSTRAINT "publication_authors_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pub_icmje_criteria" (
    "id" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "criterionIndex" INTEGER NOT NULL,
    "met" BOOLEAN NOT NULL DEFAULT false,
    "confirmedBy" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "pub_icmje_criteria_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pub_icmje_acknowledgements" (
    "id" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "acknowledgedBy" TEXT NOT NULL,
    "acknowledgedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "missingCriteria" INTEGER[],

    CONSTRAINT "pub_icmje_acknowledgements_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "debarment_check_runs" (
    "id" TEXT NOT NULL,
    "publicationId" TEXT NOT NULL,
    "runBy" TEXT NOT NULL,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "authorsChecked" INTEGER NOT NULL,
    "matchesFound" INTEGER NOT NULL DEFAULT 0,
    "sourcesQueried" TEXT[] DEFAULT ARRAY['FDA debarment list', 'OIG exclusions']::TEXT[],
    "results" JSONB NOT NULL,

    CONSTRAINT "debarment_check_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "submission_checks" (
    "id" TEXT NOT NULL,
    "publicationId" TEXT NOT NULL,
    "groupId" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'pass',
    "note" TEXT NOT NULL DEFAULT '',
    "lastRunAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "submission_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "peer_review_rounds" (
    "id" TEXT NOT NULL,
    "publicationId" TEXT NOT NULL,
    "roundNumber" INTEGER NOT NULL DEFAULT 1,
    "journalSubmissionRef" TEXT NOT NULL,
    "reviewerCount" INTEGER NOT NULL DEFAULT 3,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "peer_review_rounds_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "publications_projectId_idx" ON "publications"("projectId");

-- CreateIndex
CREATE INDEX "publications_stage_idx" ON "publications"("stage");

-- CreateIndex
CREATE INDEX "publications_status_idx" ON "publications"("status");

-- CreateIndex
CREATE INDEX "publications_type_idx" ON "publications"("type");

-- CreateIndex
CREATE INDEX "publications_sourceDocumentId_idx" ON "publications"("sourceDocumentId");

-- CreateIndex
CREATE INDEX "ai_footprint_spans_publicationId_idx" ON "ai_footprint_spans"("publicationId");

-- CreateIndex
CREATE INDEX "ai_footprint_spans_publicationId_sectionId_idx" ON "ai_footprint_spans"("publicationId", "sectionId");

-- CreateIndex
CREATE INDEX "citations_publicationId_idx" ON "citations"("publicationId");

-- CreateIndex
CREATE INDEX "citations_pmid_idx" ON "citations"("pmid");

-- CreateIndex
CREATE INDEX "publication_authors_publicationId_idx" ON "publication_authors"("publicationId");

-- CreateIndex
CREATE INDEX "publication_authors_userId_idx" ON "publication_authors"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "publication_authors_publicationId_userId_key" ON "publication_authors"("publicationId", "userId");

-- CreateIndex
CREATE INDEX "pub_icmje_criteria_authorId_idx" ON "pub_icmje_criteria"("authorId");

-- CreateIndex
CREATE UNIQUE INDEX "pub_icmje_criteria_authorId_criterionIndex_key" ON "pub_icmje_criteria"("authorId", "criterionIndex");

-- CreateIndex
CREATE INDEX "pub_icmje_acknowledgements_authorId_idx" ON "pub_icmje_acknowledgements"("authorId");

-- CreateIndex
CREATE UNIQUE INDEX "pub_icmje_acknowledgements_authorId_acknowledgedAt_key" ON "pub_icmje_acknowledgements"("authorId", "acknowledgedAt");

-- CreateIndex
CREATE INDEX "debarment_check_runs_publicationId_idx" ON "debarment_check_runs"("publicationId");

-- CreateIndex
CREATE INDEX "submission_checks_publicationId_idx" ON "submission_checks"("publicationId");

-- CreateIndex
CREATE INDEX "submission_checks_publicationId_state_idx" ON "submission_checks"("publicationId", "state");

-- CreateIndex
CREATE UNIQUE INDEX "submission_checks_publicationId_groupId_label_key" ON "submission_checks"("publicationId", "groupId", "label");

-- CreateIndex
CREATE INDEX "peer_review_rounds_publicationId_idx" ON "peer_review_rounds"("publicationId");

-- CreateIndex
CREATE UNIQUE INDEX "peer_review_rounds_publicationId_roundNumber_key" ON "peer_review_rounds"("publicationId", "roundNumber");

-- AddForeignKey
ALTER TABLE "ai_footprint_spans" ADD CONSTRAINT "ai_footprint_spans_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "publications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "citations" ADD CONSTRAINT "citations_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "publications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publication_authors" ADD CONSTRAINT "publication_authors_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "publications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pub_icmje_criteria" ADD CONSTRAINT "pub_icmje_criteria_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "publication_authors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pub_icmje_acknowledgements" ADD CONSTRAINT "pub_icmje_acknowledgements_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "publication_authors"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "debarment_check_runs" ADD CONSTRAINT "debarment_check_runs_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "publications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "submission_checks" ADD CONSTRAINT "submission_checks_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "publications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "peer_review_rounds" ADD CONSTRAINT "peer_review_rounds_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "publications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

