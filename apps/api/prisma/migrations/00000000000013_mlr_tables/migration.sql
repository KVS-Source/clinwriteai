-- Module C MLR workflow — reviewers + comments + decision records (data model §30).
-- audit_events DROP filtered per ADR 0002.


-- CreateTable
CREATE TABLE "mlr_reviewers" (
    "id" TEXT NOT NULL,
    "contentItemId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "submittedAt" TIMESTAMP(3),
    "decision" TEXT,
    "decisionNote" TEXT,

    CONSTRAINT "mlr_reviewers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mlr_comments" (
    "id" TEXT NOT NULL,
    "contentItemId" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "reviewerName" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "tag" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3),
    "resolvedBy" TEXT,
    "escalatedFromAgentic" BOOLEAN NOT NULL DEFAULT false,
    "escalatedBy" TEXT,
    "escalatedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mlr_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mlr_decision_records" (
    "id" TEXT NOT NULL,
    "contentItemId" TEXT NOT NULL,
    "decision" TEXT NOT NULL,
    "decisionNote" TEXT NOT NULL,
    "decidedBy" TEXT NOT NULL,
    "decidedByName" TEXT NOT NULL,
    "decidedByRole" TEXT NOT NULL,
    "meaning" TEXT NOT NULL,
    "credentialHash" TEXT NOT NULL,
    "documentHash" TEXT NOT NULL,
    "versionAtDecision" TEXT NOT NULL,
    "timestampUtc" TIMESTAMP(3) NOT NULL,
    "authMethod" TEXT NOT NULL DEFAULT 'password re-auth + TOTP',

    CONSTRAINT "mlr_decision_records_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "mlr_reviewers_contentItemId_idx" ON "mlr_reviewers"("contentItemId");

-- CreateIndex
CREATE UNIQUE INDEX "mlr_reviewers_contentItemId_userId_key" ON "mlr_reviewers"("contentItemId", "userId");

-- CreateIndex
CREATE INDEX "mlr_comments_contentItemId_idx" ON "mlr_comments"("contentItemId");

-- CreateIndex
CREATE INDEX "mlr_comments_contentItemId_tag_idx" ON "mlr_comments"("contentItemId", "tag");

-- CreateIndex
CREATE INDEX "mlr_decision_records_contentItemId_idx" ON "mlr_decision_records"("contentItemId");

