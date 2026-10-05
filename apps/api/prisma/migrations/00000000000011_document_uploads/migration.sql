-- document_uploads table — Module A pending-upload workflow.
-- audit_events DROP filtered per ADR 0002.


-- CreateTable
CREATE TABLE "document_uploads" (
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
    "documentId" TEXT,
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "document_uploads_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "document_uploads_projectId_idx" ON "document_uploads"("projectId");

-- CreateIndex
CREATE INDEX "document_uploads_status_idx" ON "document_uploads"("status");

-- CreateIndex
CREATE INDEX "document_uploads_documentId_idx" ON "document_uploads"("documentId");

