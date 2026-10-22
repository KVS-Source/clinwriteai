-- Reference links from document text to uploaded source documents (FR-A-022).
CREATE TABLE "source_references" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "spanText" TEXT NOT NULL,
    "uploadId" TEXT NOT NULL,
    "page" INTEGER,
    "locator" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "source_references_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "source_references_documentId_sectionId_idx" ON "source_references"("documentId", "sectionId");
CREATE INDEX "source_references_uploadId_idx" ON "source_references"("uploadId");

-- Immutable once created: the traceability record may never be edited or removed.
CREATE FUNCTION "source_references_immutable"() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'source_references rows are immutable (FR-A-022)';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER "source_references_no_change"
  BEFORE UPDATE OR DELETE ON "source_references"
  FOR EACH ROW EXECUTE FUNCTION "source_references_immutable"();
