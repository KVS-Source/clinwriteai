-- Module E — Ideation & Publishing tables (data model §45-§48).
-- audit_events DROP filtered per ADR 0002.


-- CreateTable
CREATE TABLE "ideation_projects" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "taTag" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'uploaded',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ideation_projects_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ideation_artefacts" (
    "id" TEXT NOT NULL,
    "ideationProjectId" TEXT NOT NULL,
    "sourceModule" TEXT,
    "sourceDocId" TEXT,
    "filePath" TEXT,
    "title" TEXT NOT NULL,
    "originalApprovalDate" DATE NOT NULL,
    "version" TEXT NOT NULL,
    "sourceCurrencyStatus" TEXT NOT NULL DEFAULT 'current',
    "approvalStatusCheck" TEXT NOT NULL DEFAULT 'pending',
    "masterLibraryPushDate" DATE,

    CONSTRAINT "ideation_artefacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ideation_content_cards" (
    "id" TEXT NOT NULL,
    "ideationArtefactId" TEXT NOT NULL,
    "sourceSection" TEXT NOT NULL,
    "sourcePassage" TEXT NOT NULL,
    "claimCurrencyStatus" TEXT NOT NULL DEFAULT 'current',
    "channelFormats" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "kolStatus" TEXT NOT NULL DEFAULT 'pending',
    "maStatus" TEXT NOT NULL DEFAULT 'pending',
    "overallStatus" TEXT NOT NULL DEFAULT 'uploaded',
    "provenance" JSONB NOT NULL DEFAULT '{}',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ideation_content_cards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "atomised_content" (
    "id" TEXT NOT NULL,
    "ideationContentCardId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "contentText" TEXT NOT NULL,
    "aiGenerated" BOOLEAN NOT NULL DEFAULT true,
    "aiFootprintHash" TEXT NOT NULL,
    "brandScreenPassed" BOOLEAN NOT NULL DEFAULT false,
    "complianceScreenPassed" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "atomised_content_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "claim_currency_checks" (
    "id" TEXT NOT NULL,
    "ideationArtefactId" TEXT NOT NULL,
    "runAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "claimsExtracted" JSONB NOT NULL DEFAULT '[]',
    "supersededClaims" JSONB NOT NULL DEFAULT '[]',
    "conflictingClaims" JSONB NOT NULL DEFAULT '[]',
    "acknowledgedBy" TEXT,
    "acknowledgedAt" TIMESTAMP(3),

    CONSTRAINT "claim_currency_checks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "kol_contacts" (
    "id" TEXT NOT NULL,
    "ideationProjectId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "mobileEncrypted" TEXT,
    "reviewLinkToken" TEXT NOT NULL,
    "reviewLinkExpiry" TIMESTAMP(3) NOT NULL,
    "signedOffAt" TIMESTAMP(3),
    "reminder1SentAt" TIMESTAMP(3),
    "reminder2SentAt" TIMESTAMP(3),
    "escalatedAt" TIMESTAMP(3),

    CONSTRAINT "kol_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ma_contacts" (
    "id" TEXT NOT NULL,
    "ideationProjectId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "mobileEncrypted" TEXT,
    "notificationPreference" TEXT NOT NULL DEFAULT 'email_sms',

    CONSTRAINT "ma_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "calendar_entries" (
    "id" TEXT NOT NULL,
    "ideationContentCardId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "scheduledDate" DATE NOT NULL,
    "assignedCreativeId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "publishedAt" TIMESTAMP(3),
    "publishedBy" TEXT,

    CONSTRAINT "calendar_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "publish_records" (
    "id" TEXT NOT NULL,
    "calendarEntryId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "publishedBy" TEXT NOT NULL,
    "utmParams" TEXT,
    "seoMetadata" JSONB NOT NULL DEFAULT '{}',
    "sentimentScore" DECIMAL(4,2),
    "sentimentAlertSent" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "publish_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doi_records" (
    "id" TEXT NOT NULL,
    "ideationContentCardId" TEXT NOT NULL,
    "doi" TEXT NOT NULL,
    "registeredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "crossrefResponse" JSONB NOT NULL DEFAULT '{}',

    CONSTRAINT "doi_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "dublin_core_metadata" (
    "id" TEXT NOT NULL,
    "ideationContentCardId" TEXT NOT NULL,
    "dcTitle" TEXT NOT NULL,
    "dcCreator" TEXT NOT NULL,
    "dcSubject" TEXT NOT NULL,
    "dcDescription" TEXT NOT NULL,
    "dcDate" DATE NOT NULL,
    "dcType" TEXT NOT NULL,
    "dcFormat" TEXT NOT NULL,
    "dcIdentifier" TEXT,
    "dcRights" TEXT NOT NULL,
    "dcLanguage" TEXT NOT NULL DEFAULT 'en',
    "dcSource" TEXT,
    "dcRelation" TEXT,
    "dcCoverage" TEXT,
    "dcPublisher" TEXT,
    "dcContributor" TEXT,
    "taggedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "dublin_core_metadata_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ideation_projects_projectId_idx" ON "ideation_projects"("projectId");

-- CreateIndex
CREATE INDEX "ideation_artefacts_ideationProjectId_idx" ON "ideation_artefacts"("ideationProjectId");

-- CreateIndex
CREATE INDEX "ideation_content_cards_ideationArtefactId_idx" ON "ideation_content_cards"("ideationArtefactId");

-- CreateIndex
CREATE INDEX "ideation_content_cards_overallStatus_idx" ON "ideation_content_cards"("overallStatus");

-- CreateIndex
CREATE INDEX "atomised_content_ideationContentCardId_idx" ON "atomised_content"("ideationContentCardId");

-- CreateIndex
CREATE UNIQUE INDEX "atomised_content_ideationContentCardId_channel_key" ON "atomised_content"("ideationContentCardId", "channel");

-- CreateIndex
CREATE INDEX "claim_currency_checks_ideationArtefactId_idx" ON "claim_currency_checks"("ideationArtefactId");

-- CreateIndex
CREATE INDEX "kol_contacts_ideationProjectId_idx" ON "kol_contacts"("ideationProjectId");

-- CreateIndex
CREATE INDEX "ma_contacts_ideationProjectId_idx" ON "ma_contacts"("ideationProjectId");

-- CreateIndex
CREATE INDEX "calendar_entries_scheduledDate_idx" ON "calendar_entries"("scheduledDate");

-- CreateIndex
CREATE UNIQUE INDEX "publish_records_calendarEntryId_key" ON "publish_records"("calendarEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "doi_records_ideationContentCardId_key" ON "doi_records"("ideationContentCardId");

-- CreateIndex
CREATE UNIQUE INDEX "dublin_core_metadata_ideationContentCardId_key" ON "dublin_core_metadata"("ideationContentCardId");

-- AddForeignKey
ALTER TABLE "ideation_artefacts" ADD CONSTRAINT "ideation_artefacts_ideationProjectId_fkey" FOREIGN KEY ("ideationProjectId") REFERENCES "ideation_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ideation_content_cards" ADD CONSTRAINT "ideation_content_cards_ideationArtefactId_fkey" FOREIGN KEY ("ideationArtefactId") REFERENCES "ideation_artefacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "atomised_content" ADD CONSTRAINT "atomised_content_ideationContentCardId_fkey" FOREIGN KEY ("ideationContentCardId") REFERENCES "ideation_content_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "claim_currency_checks" ADD CONSTRAINT "claim_currency_checks_ideationArtefactId_fkey" FOREIGN KEY ("ideationArtefactId") REFERENCES "ideation_artefacts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "kol_contacts" ADD CONSTRAINT "kol_contacts_ideationProjectId_fkey" FOREIGN KEY ("ideationProjectId") REFERENCES "ideation_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ma_contacts" ADD CONSTRAINT "ma_contacts_ideationProjectId_fkey" FOREIGN KEY ("ideationProjectId") REFERENCES "ideation_projects"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "calendar_entries" ADD CONSTRAINT "calendar_entries_ideationContentCardId_fkey" FOREIGN KEY ("ideationContentCardId") REFERENCES "ideation_content_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "publish_records" ADD CONSTRAINT "publish_records_calendarEntryId_fkey" FOREIGN KEY ("calendarEntryId") REFERENCES "calendar_entries"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "doi_records" ADD CONSTRAINT "doi_records_ideationContentCardId_fkey" FOREIGN KEY ("ideationContentCardId") REFERENCES "ideation_content_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "dublin_core_metadata" ADD CONSTRAINT "dublin_core_metadata_ideationContentCardId_fkey" FOREIGN KEY ("ideationContentCardId") REFERENCES "ideation_content_cards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

