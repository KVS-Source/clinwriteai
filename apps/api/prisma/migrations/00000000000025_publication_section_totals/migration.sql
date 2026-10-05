-- publication_section_totals — denominator for the AI footprint %age in Module B.
-- The manuscript editor PUT /publications/:id/section-totals populates this
-- table; GET /:id/footprint reads it to compute real percentages instead of
-- the "100% if any AI" placeholder.
-- audit_events DROP filtered per ADR 0002.


-- CreateTable
CREATE TABLE "publication_section_totals" (
    "id" TEXT NOT NULL,
    "publicationId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "totalChars" INTEGER NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "publication_section_totals_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "publication_section_totals_publicationId_idx" ON "publication_section_totals"("publicationId");

-- CreateIndex
CREATE UNIQUE INDEX "publication_section_totals_publicationId_sectionId_key" ON "publication_section_totals"("publicationId", "sectionId");
