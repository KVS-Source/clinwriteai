-- Module D — Regulatory Writing core tables (data model §37-§39).
-- audit_events DROP filtered per ADR 0002.


-- CreateTable
CREATE TABLE "regulatory_submissions" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sourceModuleAProjectId" TEXT NOT NULL,
    "submissionType" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'source_gathering',
    "stage" INTEGER NOT NULL DEFAULT 1,
    "targetHas" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ectdVersion" TEXT NOT NULL DEFAULT '3.2.2',
    "taTag" TEXT NOT NULL,
    "validatorEngine" TEXT NOT NULL DEFAULT 'extedo',
    "ownerId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "regulatory_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ectd_granularity_nodes" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "moduleSection" TEXT NOT NULL,
    "sectionTitle" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'not_started',
    "documentId" TEXT,
    "aiFootprintPct" INTEGER,
    "isReadOnly" BOOLEAN NOT NULL DEFAULT false,
    "isSystemGenerated" BOOLEAN NOT NULL DEFAULT false,
    "lastUpdated" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ectd_granularity_nodes_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "canonical_json_entries" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "sourceDocId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "content" JSONB NOT NULL,
    "version" TEXT NOT NULL,
    "indexedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "canonical_json_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "cmc_readiness_reports" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "completenessPct" INTEGER NOT NULL,
    "missingItems" JSONB NOT NULL DEFAULT '[]',
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedBy" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "riskNote" TEXT,

    CONSTRAINT "cmc_readiness_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consistency_check_results" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "model" TEXT NOT NULL,
    "passed" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "consistency_check_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consistency_contradictions" (
    "id" TEXT NOT NULL,
    "resultId" TEXT NOT NULL,
    "sourceSection" TEXT NOT NULL,
    "targetSection" TEXT NOT NULL,
    "sourceValue" TEXT NOT NULL,
    "targetValue" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolutionNote" TEXT,

    CONSTRAINT "consistency_contradictions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "redaction_records" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "ppdItems" JSONB NOT NULL DEFAULT '[]',
    "cciItems" JSONB NOT NULL DEFAULT '[]',
    "stageAtCreation" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "redaction_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ectd_validation_results" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "validator" TEXT NOT NULL,
    "criticalCount" INTEGER NOT NULL DEFAULT 0,
    "majorCount" INTEGER NOT NULL DEFAULT 0,
    "minorCount" INTEGER NOT NULL DEFAULT 0,
    "passed" BOOLEAN NOT NULL DEFAULT true,
    "errors" JSONB NOT NULL DEFAULT '[]',

    CONSTRAINT "ectd_validation_results_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "regulatory_submissions_projectId_idx" ON "regulatory_submissions"("projectId");

-- CreateIndex
CREATE INDEX "regulatory_submissions_status_idx" ON "regulatory_submissions"("status");

-- CreateIndex
CREATE INDEX "ectd_granularity_nodes_submissionId_idx" ON "ectd_granularity_nodes"("submissionId");

-- CreateIndex
CREATE UNIQUE INDEX "ectd_granularity_nodes_submissionId_moduleSection_key" ON "ectd_granularity_nodes"("submissionId", "moduleSection");

-- CreateIndex
CREATE INDEX "canonical_json_entries_submissionId_idx" ON "canonical_json_entries"("submissionId");

-- CreateIndex
CREATE UNIQUE INDEX "cmc_readiness_reports_submissionId_key" ON "cmc_readiness_reports"("submissionId");

-- CreateIndex
CREATE INDEX "consistency_check_results_submissionId_idx" ON "consistency_check_results"("submissionId");

-- CreateIndex
CREATE INDEX "consistency_contradictions_resultId_idx" ON "consistency_contradictions"("resultId");

-- CreateIndex
CREATE INDEX "consistency_contradictions_resultId_resolved_idx" ON "consistency_contradictions"("resultId", "resolved");

-- CreateIndex
CREATE INDEX "redaction_records_submissionId_idx" ON "redaction_records"("submissionId");

-- CreateIndex
CREATE INDEX "ectd_validation_results_submissionId_idx" ON "ectd_validation_results"("submissionId");

-- AddForeignKey
ALTER TABLE "ectd_granularity_nodes" ADD CONSTRAINT "ectd_granularity_nodes_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "regulatory_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "canonical_json_entries" ADD CONSTRAINT "canonical_json_entries_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "regulatory_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "cmc_readiness_reports" ADD CONSTRAINT "cmc_readiness_reports_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "regulatory_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consistency_check_results" ADD CONSTRAINT "consistency_check_results_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "regulatory_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consistency_contradictions" ADD CONSTRAINT "consistency_contradictions_resultId_fkey" FOREIGN KEY ("resultId") REFERENCES "consistency_check_results"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "redaction_records" ADD CONSTRAINT "redaction_records_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "regulatory_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ectd_validation_results" ADD CONSTRAINT "ectd_validation_results_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "regulatory_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

