-- Module C: pending med-content uploads (mirror of document_uploads).
CREATE TABLE "content_uploads" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "uploadedBy" TEXT NOT NULL,
    "blobKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileSizeBytes" INTEGER NOT NULL,
    "contentType" TEXT NOT NULL,
    "virusScanStatus" TEXT NOT NULL DEFAULT 'pending',
    "classification" JSONB,
    "status" TEXT NOT NULL DEFAULT 'pending_classification',
    "contentItemId" TEXT,
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "content_uploads_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "content_uploads_projectId_idx"     ON "content_uploads"("projectId");
CREATE INDEX "content_uploads_status_idx"        ON "content_uploads"("status");
CREATE INDEX "content_uploads_contentItemId_idx" ON "content_uploads"("contentItemId");
