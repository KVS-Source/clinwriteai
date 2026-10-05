-- Module B congress submissions table (§22.1). OQ-B-004 — no live portal.
-- audit_events DROP filtered per ADR 0002.


-- CreateTable
CREATE TABLE "congress_submissions" (
    "id" TEXT NOT NULL,
    "publicationId" TEXT NOT NULL,
    "congressId" TEXT NOT NULL,
    "congressName" TEXT NOT NULL,
    "characterLimit" INTEGER NOT NULL,
    "keywordsRequired" INTEGER NOT NULL,
    "keywordsEntered" INTEGER NOT NULL DEFAULT 0,
    "deadline" DATE NOT NULL,
    "portalUrl" TEXT NOT NULL,
    "characterCount" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'draft',
    "exportedAt" TIMESTAMP(3),
    "exportedBy" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "congress_submissions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "congress_submissions_publicationId_idx" ON "congress_submissions"("publicationId");

-- CreateIndex
CREATE INDEX "congress_submissions_publicationId_status_idx" ON "congress_submissions"("publicationId", "status");

-- AddForeignKey
ALTER TABLE "congress_submissions" ADD CONSTRAINT "congress_submissions_publicationId_fkey" FOREIGN KEY ("publicationId") REFERENCES "publications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

