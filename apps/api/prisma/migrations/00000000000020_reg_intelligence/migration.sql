-- Regulatory intelligence batch:
--   - Platform regulatory_alerts (§53 cross-module push service)
--   - Module D aggregate_safety_reports (PSUR/PBRER authoring, FR-D-015)
--   - Module D odd_assessments (orphan drug designation)
-- audit_events DROP filtered per ADR 0002.


-- CreateTable
CREATE TABLE "aggregate_safety_reports" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "reportType" TEXT NOT NULL,
    "reportingPeriodStart" DATE NOT NULL,
    "reportingPeriodEnd" DATE NOT NULL,
    "dataLockPoint" DATE NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "signalSummary" TEXT NOT NULL DEFAULT '',
    "benefitRiskSummary" TEXT NOT NULL DEFAULT '',
    "aiFootprintPct" INTEGER,
    "pvLeadVerifiedBy" TEXT,
    "pvLeadVerifiedAt" TIMESTAMP(3),
    "pvLeadVerificationNote" TEXT,
    "generatedBy" TEXT NOT NULL,
    "generatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),

    CONSTRAINT "aggregate_safety_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "odd_assessments" (
    "id" TEXT NOT NULL,
    "submissionId" TEXT NOT NULL,
    "diseaseIndication" TEXT NOT NULL,
    "prevalencePer100k" DECIMAL(8,3) NOT NULL,
    "medicalNeedJustification" TEXT NOT NULL,
    "significantBenefit" TEXT,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "issuingAuthority" TEXT,
    "designationNumber" TEXT,
    "approvalDate" DATE,
    "rejectionReason" TEXT,
    "completedBy" TEXT,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "odd_assessments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "regulatory_alerts" (
    "id" TEXT NOT NULL,
    "frameworkName" TEXT NOT NULL,
    "changeSummary" TEXT NOT NULL,
    "effectiveDate" DATE NOT NULL,
    "affectedModules" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "severity" TEXT NOT NULL DEFAULT 'info',
    "sourceUrl" TEXT,
    "alertedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedByIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "publishedBy" TEXT NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "regulatory_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "aggregate_safety_reports_submissionId_idx" ON "aggregate_safety_reports"("submissionId");

-- CreateIndex
CREATE INDEX "aggregate_safety_reports_submissionId_reportType_idx" ON "aggregate_safety_reports"("submissionId", "reportType");

-- CreateIndex
CREATE INDEX "aggregate_safety_reports_dataLockPoint_idx" ON "aggregate_safety_reports"("dataLockPoint");

-- CreateIndex
CREATE INDEX "odd_assessments_submissionId_idx" ON "odd_assessments"("submissionId");

-- CreateIndex
CREATE INDEX "odd_assessments_status_idx" ON "odd_assessments"("status");

-- CreateIndex
CREATE INDEX "regulatory_alerts_alertedAt_idx" ON "regulatory_alerts"("alertedAt" DESC);

-- CreateIndex
CREATE INDEX "regulatory_alerts_effectiveDate_idx" ON "regulatory_alerts"("effectiveDate");

-- AddForeignKey
ALTER TABLE "aggregate_safety_reports" ADD CONSTRAINT "aggregate_safety_reports_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "regulatory_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "odd_assessments" ADD CONSTRAINT "odd_assessments_submissionId_fkey" FOREIGN KEY ("submissionId") REFERENCES "regulatory_submissions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
