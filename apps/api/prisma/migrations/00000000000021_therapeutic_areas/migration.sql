-- Platform taxonomy — therapeutic_areas (TA tag catalogue).
-- Normalises the free-text TA strings used across modules; existing
-- free-text columns stay in place for backwards compat.
-- audit_events DROP filtered per ADR 0002.


-- CreateTable
CREATE TABLE "therapeutic_areas" (
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "parentCode" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "description" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "archivedAt" TIMESTAMP(3),

    CONSTRAINT "therapeutic_areas_pkey" PRIMARY KEY ("code")
);

-- CreateIndex
CREATE INDEX "therapeutic_areas_parentCode_idx" ON "therapeutic_areas"("parentCode");

-- CreateIndex
CREATE INDEX "therapeutic_areas_status_idx" ON "therapeutic_areas"("status");

-- AddForeignKey
ALTER TABLE "therapeutic_areas" ADD CONSTRAINT "therapeutic_areas_parentCode_fkey" FOREIGN KEY ("parentCode") REFERENCES "therapeutic_areas"("code") ON DELETE SET NULL ON UPDATE CASCADE;
