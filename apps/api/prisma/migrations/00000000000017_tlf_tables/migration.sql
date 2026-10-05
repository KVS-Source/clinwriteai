-- Module A TLF — tables / listings / figures packages (data model §12).
-- audit_events DROP filtered per ADR 0002.


-- CreateTable
CREATE TABLE "tlf_packages" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "validatedBy" TEXT NOT NULL,
    "validatedAt" TIMESTAMP(3) NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tlf_packages_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tlf_items" (
    "id" TEXT NOT NULL,
    "packageId" TEXT NOT NULL,
    "itemType" TEXT NOT NULL,
    "referenceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "tlf_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tlf_section_links" (
    "id" TEXT NOT NULL,
    "tlfItemId" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "sectionRef" TEXT NOT NULL,
    "referenceCount" INTEGER NOT NULL DEFAULT 1,

    CONSTRAINT "tlf_section_links_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "tlf_packages_projectId_idx" ON "tlf_packages"("projectId");

CREATE INDEX "tlf_packages_projectId_isCurrent_idx" ON "tlf_packages"("projectId", "isCurrent");

CREATE UNIQUE INDEX "tlf_packages_projectId_version_key" ON "tlf_packages"("projectId", "version");

CREATE INDEX "tlf_items_packageId_idx" ON "tlf_items"("packageId");

CREATE UNIQUE INDEX "tlf_items_packageId_referenceId_key" ON "tlf_items"("packageId", "referenceId");

CREATE INDEX "tlf_section_links_tlfItemId_idx" ON "tlf_section_links"("tlfItemId");

CREATE INDEX "tlf_section_links_documentId_sectionRef_idx" ON "tlf_section_links"("documentId", "sectionRef");

CREATE UNIQUE INDEX "tlf_section_links_tlfItemId_documentId_sectionRef_key" ON "tlf_section_links"("tlfItemId", "documentId", "sectionRef");

-- AddForeignKey
ALTER TABLE "tlf_items" ADD CONSTRAINT "tlf_items_packageId_fkey" FOREIGN KEY ("packageId") REFERENCES "tlf_packages"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tlf_section_links" ADD CONSTRAINT "tlf_section_links_tlfItemId_fkey" FOREIGN KEY ("tlfItemId") REFERENCES "tlf_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;
