-- Rate-card hot reload — DB-backed per-model USD rates with version history.
-- AiCallRecord gets a nullable FK to the rate card version it was priced
-- under; existing rows stay valid (NULL means 'priced from the in-code
-- RATES array before DB-backed rate cards shipped').
-- audit_events DROP filtered per ADR 0002.


-- AlterTable
ALTER TABLE "ai_call_records" ADD COLUMN     "rateCardVersionId" TEXT;

-- CreateTable
CREATE TABLE "rate_card_versions" (
    "id" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "publishedBy" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,

    CONSTRAINT "rate_card_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rate_card_entries" (
    "id" TEXT NOT NULL,
    "rateCardVersionId" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputPer1M" DECIMAL(10,4) NOT NULL,
    "outputPer1M" DECIMAL(10,4) NOT NULL,
    "cachedInputPer1M" DECIMAL(10,4) NOT NULL,

    CONSTRAINT "rate_card_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "rate_card_versions_version_key" ON "rate_card_versions"("version");

-- CreateIndex
CREATE INDEX "rate_card_versions_isActive_idx" ON "rate_card_versions"("isActive");

-- CreateIndex
CREATE INDEX "rate_card_entries_rateCardVersionId_idx" ON "rate_card_entries"("rateCardVersionId");

-- CreateIndex
CREATE UNIQUE INDEX "rate_card_entries_rateCardVersionId_model_key" ON "rate_card_entries"("rateCardVersionId", "model");

-- AddForeignKey
ALTER TABLE "ai_call_records" ADD CONSTRAINT "ai_call_records_rateCardVersionId_fkey" FOREIGN KEY ("rateCardVersionId") REFERENCES "rate_card_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rate_card_entries" ADD CONSTRAINT "rate_card_entries_rateCardVersionId_fkey" FOREIGN KEY ("rateCardVersionId") REFERENCES "rate_card_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;
