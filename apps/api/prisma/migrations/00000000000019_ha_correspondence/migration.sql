-- Module D HA correspondence — post-submission authority round-trip (data model §53).
-- audit_events DROP filtered per ADR 0002.


-- CreateTable
CREATE TABLE "ha_correspondence" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "direction" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "contentSummary" TEXT NOT NULL,
    "receivedAt" TIMESTAMP(3),
    "respondedAt" TIMESTAMP(3),
    "loqDocId" TEXT,
    "responseDocId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ha_correspondence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ha_loq_questions" (
    "id" TEXT NOT NULL,
    "correspondenceId" TEXT NOT NULL,
    "questionRef" TEXT NOT NULL,
    "questionText" TEXT NOT NULL,
    "category" TEXT,
    "status" TEXT NOT NULL DEFAULT 'open',
    "sourceModuleRef" TEXT,
    "dueDate" TIMESTAMP(3),
    "responseAt" TIMESTAMP(3),

    CONSTRAINT "ha_loq_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ha_response_drafts" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "versionNumber" INTEGER NOT NULL,
    "draftText" TEXT NOT NULL,
    "sourceRefs" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "aiFootprintPct" INTEGER,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "reviewedBy" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ha_response_drafts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ha_correspondence_submissionId_idx" ON "ha_correspondence"("submissionId");

-- CreateIndex
CREATE INDEX "ha_correspondence_submissionId_type_idx" ON "ha_correspondence"("submissionId", "type");

-- CreateIndex
CREATE INDEX "ha_loq_questions_correspondenceId_idx" ON "ha_loq_questions"("correspondenceId");

-- CreateIndex
CREATE INDEX "ha_loq_questions_correspondenceId_status_idx" ON "ha_loq_questions"("correspondenceId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ha_loq_questions_correspondenceId_questionRef_key" ON "ha_loq_questions"("correspondenceId", "questionRef");

-- CreateIndex
CREATE INDEX "ha_response_drafts_questionId_idx" ON "ha_response_drafts"("questionId");

-- CreateIndex
CREATE INDEX "ha_response_drafts_questionId_status_idx" ON "ha_response_drafts"("questionId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "ha_response_drafts_questionId_versionNumber_key" ON "ha_response_drafts"("questionId", "versionNumber");

-- AddForeignKey
ALTER TABLE "ha_correspondence" ADD CONSTRAINT "ha_correspondence_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "regulatory_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ha_loq_questions" ADD CONSTRAINT "ha_loq_questions_correspondenceId_fkey" FOREIGN KEY ("correspondenceId") REFERENCES "ha_correspondence"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ha_response_drafts" ADD CONSTRAINT "ha_response_drafts_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "ha_loq_questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
