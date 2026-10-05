-- Module A — Clinical Writing tables (docs/demo/02-datamodel.md §4-§6).
-- Generated via prisma migrate diff; the audit_events DROP that Prisma
-- emits (because it lives outside the schema per ADR 0002) was filtered.


-- CreateTable
CREATE TABLE "documents" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'not_started',
    "stage" TEXT NOT NULL DEFAULT 'study_start_up',
    "therapeuticArea" TEXT NOT NULL,
    "templateId" TEXT,
    "assigneeId" TEXT NOT NULL,
    "currentVersionId" TEXT,
    "targetCompletionDate" TIMESTAMP(3),
    "submittedForReviewAt" TIMESTAMP(3),
    "signedAt" TIMESTAMP(3),
    "watermarked" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "deletedAt" TIMESTAMP(3),

    CONSTRAINT "documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_versions" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "versionNumber" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "contentHash" TEXT NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "restoreSource" JSONB,

    CONSTRAINT "document_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "section_contents" (
    "id" TEXT NOT NULL,
    "documentVersionId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "sectionNumber" TEXT NOT NULL,
    "sectionTitle" TEXT NOT NULL,
    "contentHtml" TEXT NOT NULL DEFAULT '',
    "ichStatus" TEXT NOT NULL DEFAULT 'not_started',
    "wordCount" INTEGER NOT NULL DEFAULT 0,
    "aiSpanCount" INTEGER NOT NULL DEFAULT 0,
    "humanSpanCount" INTEGER NOT NULL DEFAULT 0,
    "lastEditedBy" TEXT,
    "lastEditedAt" TIMESTAMP(3),

    CONSTRAINT "section_contents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "provenance_records" (
    "id" TEXT NOT NULL,
    "documentVersionId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "spanId" TEXT NOT NULL,
    "spanText" TEXT NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceRef" TEXT,
    "aiModel" TEXT,
    "aiGeneratedAt" TIMESTAMP(3),
    "acceptedBy" TEXT,
    "acceptedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "provenance_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "version_restore_jobs" (
    "id" TEXT NOT NULL,
    "sourceDocumentId" TEXT NOT NULL,
    "createdVersionId" TEXT,
    "sectionsRestored" JSONB NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "version_restore_jobs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checklist_templates" (
    "id" TEXT NOT NULL,
    "deliverableType" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "effectiveDate" TIMESTAMP(3) NOT NULL,
    "changeReason" TEXT NOT NULL,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "checklist_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checklist_template_items" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "framework" TEXT NOT NULL,
    "frameworkMandatory" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "checklist_template_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checklist_instances" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "templateVersion" INTEGER NOT NULL,
    "notificationSentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "checklist_instances_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "checklist_instance_items" (
    "id" TEXT NOT NULL,
    "instanceId" TEXT NOT NULL,
    "templateItemId" TEXT,
    "text" TEXT NOT NULL,
    "framework" TEXT NOT NULL,
    "frameworkMandatory" BOOLEAN NOT NULL DEFAULT true,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "isUserAdded" BOOLEAN NOT NULL DEFAULT false,
    "completedBy" TEXT,
    "completedAt" TIMESTAMP(3),
    "waivedBy" TEXT,
    "waivedAt" TIMESTAMP(3),
    "waiverReason" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "checklist_instance_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "comments" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "sectionRef" TEXT NOT NULL,
    "reviewerId" TEXT NOT NULL,
    "text" TEXT NOT NULL,
    "severity" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'open',
    "resolvedBy" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "comments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "documents_currentVersionId_key" ON "documents"("currentVersionId");

-- CreateIndex
CREATE INDEX "documents_projectId_idx" ON "documents"("projectId");

-- CreateIndex
CREATE INDEX "documents_status_idx" ON "documents"("status");

-- CreateIndex
CREATE INDEX "documents_stage_idx" ON "documents"("stage");

-- CreateIndex
CREATE INDEX "documents_assigneeId_idx" ON "documents"("assigneeId");

-- CreateIndex
CREATE INDEX "document_versions_documentId_idx" ON "document_versions"("documentId");

-- CreateIndex
CREATE UNIQUE INDEX "document_versions_documentId_versionNumber_key" ON "document_versions"("documentId", "versionNumber");

-- CreateIndex
CREATE INDEX "section_contents_documentVersionId_idx" ON "section_contents"("documentVersionId");

-- CreateIndex
CREATE INDEX "section_contents_ichStatus_idx" ON "section_contents"("ichStatus");

-- CreateIndex
CREATE UNIQUE INDEX "section_contents_documentVersionId_sectionId_key" ON "section_contents"("documentVersionId", "sectionId");

-- CreateIndex
CREATE INDEX "provenance_records_documentVersionId_idx" ON "provenance_records"("documentVersionId");

-- CreateIndex
CREATE INDEX "provenance_records_documentVersionId_sectionId_idx" ON "provenance_records"("documentVersionId", "sectionId");

-- CreateIndex
CREATE INDEX "provenance_records_spanId_idx" ON "provenance_records"("spanId");

-- CreateIndex
CREATE INDEX "version_restore_jobs_sourceDocumentId_idx" ON "version_restore_jobs"("sourceDocumentId");

-- CreateIndex
CREATE INDEX "checklist_templates_deliverableType_idx" ON "checklist_templates"("deliverableType");

-- CreateIndex
CREATE UNIQUE INDEX "checklist_templates_deliverableType_version_key" ON "checklist_templates"("deliverableType", "version");

-- CreateIndex
CREATE INDEX "checklist_template_items_templateId_idx" ON "checklist_template_items"("templateId");

-- CreateIndex
CREATE UNIQUE INDEX "checklist_instances_documentId_key" ON "checklist_instances"("documentId");

-- CreateIndex
CREATE INDEX "checklist_instance_items_instanceId_idx" ON "checklist_instance_items"("instanceId");

-- CreateIndex
CREATE INDEX "checklist_instance_items_instanceId_status_idx" ON "checklist_instance_items"("instanceId", "status");

-- CreateIndex
CREATE INDEX "comments_documentId_idx" ON "comments"("documentId");

-- CreateIndex
CREATE INDEX "comments_documentId_status_idx" ON "comments"("documentId", "status");

-- CreateIndex
CREATE INDEX "comments_documentId_sectionRef_idx" ON "comments"("documentId", "sectionRef");

-- AddForeignKey
ALTER TABLE "documents" ADD CONSTRAINT "documents_currentVersionId_fkey" FOREIGN KEY ("currentVersionId") REFERENCES "document_versions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "document_versions" ADD CONSTRAINT "document_versions_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "section_contents" ADD CONSTRAINT "section_contents_documentVersionId_fkey" FOREIGN KEY ("documentVersionId") REFERENCES "document_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "provenance_records" ADD CONSTRAINT "provenance_records_documentVersionId_fkey" FOREIGN KEY ("documentVersionId") REFERENCES "document_versions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_template_items" ADD CONSTRAINT "checklist_template_items_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "checklist_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_instances" ADD CONSTRAINT "checklist_instances_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_instances" ADD CONSTRAINT "checklist_instances_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "checklist_templates"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_instance_items" ADD CONSTRAINT "checklist_instance_items_instanceId_fkey" FOREIGN KEY ("instanceId") REFERENCES "checklist_instances"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "checklist_instance_items" ADD CONSTRAINT "checklist_instance_items_templateItemId_fkey" FOREIGN KEY ("templateItemId") REFERENCES "checklist_template_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "comments" ADD CONSTRAINT "comments_documentId_fkey" FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE;

