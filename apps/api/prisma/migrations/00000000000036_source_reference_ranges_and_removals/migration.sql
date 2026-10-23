-- Where each reference sits in its section: start/end character offsets into the section's
-- whitespace-collapsed text, so two references with the same wording (or several in one
-- paragraph) each point at their own range. Nullable — older references have only spanText.
ALTER TABLE "source_references" ADD COLUMN "startOffset" INTEGER;
ALTER TABLE "source_references" ADD COLUMN "endOffset" INTEGER;

-- A reference link withdrawn by a user. source_references stays immutable (FR-A-022);
-- the removal is its own append-only record and lists skip removed references.
CREATE TABLE "source_reference_removals" (
    "id" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "reason" TEXT,
    "removedBy" TEXT NOT NULL,
    "removedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "source_reference_removals_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "source_reference_removals_referenceId_key" ON "source_reference_removals"("referenceId");
CREATE INDEX "source_reference_removals_documentId_idx" ON "source_reference_removals"("documentId");

-- Append-only, like the references themselves.
CREATE TRIGGER "source_reference_removals_no_change"
  BEFORE UPDATE OR DELETE ON "source_reference_removals"
  FOR EACH ROW EXECUTE FUNCTION "source_references_immutable"();
