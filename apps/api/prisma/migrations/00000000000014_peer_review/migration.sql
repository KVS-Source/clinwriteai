-- Module B peer review — reviewer comments + response letter versions (§23.2-§23.3).
-- Also adds peer_review_rounds.submitted_at for the round-lock state.
-- audit_events DROP filtered per ADR 0002.

-- AlterTable
ALTER TABLE "peer_review_rounds" ADD COLUMN     "submittedAt" TIMESTAMP(3);


-- CreateTable
CREATE TABLE "reviewer_comments" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "reviewerTab" TEXT NOT NULL,
    "commentNumber" INTEGER NOT NULL,
    "commentText" TEXT NOT NULL,
    "responseText" TEXT NOT NULL DEFAULT '',
    "status" TEXT NOT NULL DEFAULT 'not_started',
    "aiDrafted" BOOLEAN NOT NULL DEFAULT false,
    "aiModel" TEXT,
    "aiGeneratedAt" TIMESTAMP(3),
    "aiAcceptedBy" TEXT,
    "aiAcceptedAt" TIMESTAMP(3),
    "respondedBy" TEXT,
    "respondedAt" TIMESTAMP(3),

    CONSTRAINT "reviewer_comments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "response_letter_versions" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "letterVersion" TEXT NOT NULL,
    "respondedCount" INTEGER NOT NULL,
    "totalCount" INTEGER NOT NULL,
    "contentHash" TEXT NOT NULL,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "response_letter_versions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "reviewer_comments_roundId_idx" ON "reviewer_comments"("roundId");

-- CreateIndex
CREATE INDEX "reviewer_comments_roundId_status_idx" ON "reviewer_comments"("roundId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "reviewer_comments_roundId_reviewerTab_commentNumber_key" ON "reviewer_comments"("roundId", "reviewerTab", "commentNumber");

-- CreateIndex
CREATE INDEX "response_letter_versions_roundId_idx" ON "response_letter_versions"("roundId");

-- AddForeignKey
ALTER TABLE "reviewer_comments" ADD CONSTRAINT "reviewer_comments_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "peer_review_rounds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "response_letter_versions" ADD CONSTRAINT "response_letter_versions_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "peer_review_rounds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

