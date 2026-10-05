-- Module C — Medical Writing tables (docs/demo/02-datamodel.md §28-§29).
-- Generated via prisma migrate diff; audit_events DROP filtered per ADR 0002.


-- CreateTable
CREATE TABLE "med_content_items" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sourceModuleAProjectId" TEXT NOT NULL,
    "sourceModuleBPubId" TEXT,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'briefing',
    "stage" INTEGER NOT NULL DEFAULT 1,
    "complianceTrack" TEXT NOT NULL,
    "taTag" TEXT NOT NULL,
    "version" TEXT NOT NULL DEFAULT 'v0.1',
    "channels" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "targetAudience" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "reviewTier" TEXT,
    "tierOverriddenBy" TEXT,
    "fkScore" DECIMAL(4,1),
    "fkPassed" BOOLEAN,
    "aiFootprintPct" INTEGER,
    "expiryDate" DATE,
    "approvedAt" TIMESTAMP(3),
    "medicalAffairsPlanId" TEXT,
    "publicationPlanId" TEXT,
    "ownerId" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),
    "archiveReason" TEXT,

    CONSTRAINT "med_content_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "claims_matrix_items" (
    "id" TEXT NOT NULL,
    "contentItemId" TEXT NOT NULL,
    "claimText" TEXT NOT NULL,
    "sourceRef" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "location" TEXT NOT NULL,
    "approvalStatus" TEXT NOT NULL DEFAULT 'new',
    "reviewerId" TEXT,
    "similarityPct" INTEGER,
    "approvedLibraryText" TEXT,
    "adoptedAt" TIMESTAMP(3),
    "harvestedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "claims_matrix_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_tier_records" (
    "id" TEXT NOT NULL,
    "contentItemId" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "reusePct" INTEGER NOT NULL,
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "overriddenBy" TEXT,
    "overrideReason" TEXT,

    CONSTRAINT "review_tier_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "fk_score_records" (
    "id" TEXT NOT NULL,
    "contentItemId" TEXT NOT NULL,
    "score" DECIMAL(4,1) NOT NULL,
    "passed" BOOLEAN NOT NULL,
    "calculatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "bySection" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "fk_score_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pre_mlr_check_results" (
    "id" TEXT NOT NULL,
    "contentItemId" TEXT NOT NULL,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "mustFixCount" INTEGER NOT NULL DEFAULT 0,
    "shouldFixCount" INTEGER NOT NULL DEFAULT 0,
    "noteCount" INTEGER NOT NULL DEFAULT 0,
    "passed" BOOLEAN NOT NULL DEFAULT true,
    "runBy" TEXT NOT NULL,

    CONSTRAINT "pre_mlr_check_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pre_mlr_issues" (
    "id" TEXT NOT NULL,
    "checkResultId" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "slide" TEXT,
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "suggestedFix" TEXT,
    "acknowledged" BOOLEAN NOT NULL DEFAULT false,
    "acknowledgedBy" TEXT,
    "acknowledgedAt" TIMESTAMP(3),

    CONSTRAINT "pre_mlr_issues_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "med_content_items_projectId_idx" ON "med_content_items"("projectId");

-- CreateIndex
CREATE INDEX "med_content_items_status_idx" ON "med_content_items"("status");

-- CreateIndex
CREATE INDEX "med_content_items_type_idx" ON "med_content_items"("type");

-- CreateIndex
CREATE INDEX "med_content_items_taTag_idx" ON "med_content_items"("taTag");

-- CreateIndex
CREATE INDEX "med_content_items_expiryDate_idx" ON "med_content_items"("expiryDate");

-- CreateIndex
CREATE INDEX "med_content_items_sourceModuleAProjectId_idx" ON "med_content_items"("sourceModuleAProjectId");

-- CreateIndex
CREATE INDEX "med_content_items_sourceModuleBPubId_idx" ON "med_content_items"("sourceModuleBPubId");

-- CreateIndex
CREATE INDEX "claims_matrix_items_contentItemId_idx" ON "claims_matrix_items"("contentItemId");

-- CreateIndex
CREATE INDEX "claims_matrix_items_contentItemId_approvalStatus_idx" ON "claims_matrix_items"("contentItemId", "approvalStatus");

-- CreateIndex
CREATE INDEX "claims_matrix_items_contentItemId_similarityPct_idx" ON "claims_matrix_items"("contentItemId", "similarityPct");

-- CreateIndex
CREATE INDEX "review_tier_records_contentItemId_idx" ON "review_tier_records"("contentItemId");

-- CreateIndex
CREATE INDEX "fk_score_records_contentItemId_idx" ON "fk_score_records"("contentItemId");

-- CreateIndex
CREATE INDEX "fk_score_records_contentItemId_calculatedAt_idx" ON "fk_score_records"("contentItemId", "calculatedAt");

-- CreateIndex
CREATE INDEX "pre_mlr_check_results_contentItemId_idx" ON "pre_mlr_check_results"("contentItemId");

-- CreateIndex
CREATE INDEX "pre_mlr_check_results_contentItemId_runAt_idx" ON "pre_mlr_check_results"("contentItemId", "runAt");

-- CreateIndex
CREATE INDEX "pre_mlr_issues_checkResultId_idx" ON "pre_mlr_issues"("checkResultId");

-- AddForeignKey
ALTER TABLE "claims_matrix_items" ADD CONSTRAINT "claims_matrix_items_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "med_content_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_tier_records" ADD CONSTRAINT "review_tier_records_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "med_content_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "fk_score_records" ADD CONSTRAINT "fk_score_records_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "med_content_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pre_mlr_check_results" ADD CONSTRAINT "pre_mlr_check_results_contentItemId_fkey" FOREIGN KEY ("contentItemId") REFERENCES "med_content_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "pre_mlr_issues" ADD CONSTRAINT "pre_mlr_issues_checkResultId_fkey" FOREIGN KEY ("checkResultId") REFERENCES "pre_mlr_check_results"("id") ON DELETE CASCADE ON UPDATE CASCADE;

