-- Source documents are evidence, not authored documents. Give each upload its own
-- category / title / origin, and link uploads to the documents written from them
-- (many-to-many) instead of the old one-upload-one-document document_uploads.documentId.
ALTER TABLE "document_uploads"
  ADD COLUMN "title" TEXT,
  ADD COLUMN "sourceCategory" TEXT,
  ADD COLUMN "origin" TEXT,
  ADD COLUMN "version" TEXT;

CREATE TABLE "document_sources" (
    "documentId" TEXT NOT NULL,
    "uploadId" TEXT NOT NULL,
    "linkedBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "document_sources_pkey" PRIMARY KEY ("documentId", "uploadId")
);

CREATE INDEX "document_sources_uploadId_idx" ON "document_sources"("uploadId");

-- Backfill from the legacy 1:1 link.
INSERT INTO "document_sources" ("documentId", "uploadId", "linkedBy", "createdAt")
SELECT "documentId", "id", "uploadedBy", "updatedAt"
FROM "document_uploads"
WHERE "documentId" IS NOT NULL
ON CONFLICT DO NOTHING;
