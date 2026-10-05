-- Phase 4 Platform services — library, notifications, framework, RACI, AI gateway.
-- audit_events DROP filtered per ADR 0002.


-- CreateTable
CREATE TABLE "library_sections" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "taTag" TEXT NOT NULL,
    "framework" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "isCurrent" BOOLEAN NOT NULL DEFAULT true,
    "usageCount" INTEGER NOT NULL DEFAULT 0,
    "approvedBy" TEXT NOT NULL,
    "approvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "supersededBy" TEXT,
    "retiredAt" TIMESTAMP(3),
    "tags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "library_sections_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "library_adoption_records" (
    "id" TEXT NOT NULL,
    "libraryId" TEXT NOT NULL,
    "adoptingModule" TEXT NOT NULL,
    "adoptingEntity" TEXT NOT NULL,
    "adoptedBy" TEXT NOT NULL,
    "adoptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "library_adoption_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notifications" (
    "id" TEXT NOT NULL,
    "recipientId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "severity" TEXT NOT NULL DEFAULT 'info',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "linkPath" TEXT,
    "channels" TEXT[] DEFAULT ARRAY['in_app']::TEXT[],
    "payload" JSONB NOT NULL DEFAULT '{}',
    "readAt" TIMESTAMP(3),
    "dismissedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "notifications_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification_deliveries" (
    "id" TEXT NOT NULL,
    "notificationId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "attemptedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "deliveredAt" TIMESTAMP(3),
    "provider" TEXT,
    "providerRef" TEXT,
    "error" TEXT,

    CONSTRAINT "notification_deliveries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "regulatory_frameworks" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "version" TEXT NOT NULL,
    "jurisdiction" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "effectiveDate" DATE NOT NULL,
    "retiredAt" TIMESTAMP(3),
    "description" TEXT,
    "sourceUrl" TEXT,
    "createdBy" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "regulatory_frameworks_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "raci_assignments" (
    "id" TEXT NOT NULL,
    "projectId" TEXT NOT NULL,
    "activity" TEXT NOT NULL,
    "responsibleId" TEXT,
    "accountableId" TEXT,
    "consultedIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "informedIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "updatedBy" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "raci_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_call_records" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT,
    "projectId" TEXT,
    "actorId" TEXT NOT NULL,
    "module" TEXT NOT NULL,
    "intent" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL,
    "outputTokens" INTEGER NOT NULL,
    "cachedTokens" INTEGER NOT NULL DEFAULT 0,
    "costUsd" DECIMAL(10,6) NOT NULL,
    "latencyMs" INTEGER NOT NULL,
    "limitDecision" TEXT NOT NULL DEFAULT 'allowed',
    "piiScrubbed" BOOLEAN NOT NULL DEFAULT false,
    "errorCode" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ai_call_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ai_tenant_quotas" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "monthlyCapUsd" DECIMAL(10,2) NOT NULL,
    "warnAtPct" INTEGER NOT NULL DEFAULT 80,
    "rejectAtPct" INTEGER NOT NULL DEFAULT 100,
    "rolloverDay" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ai_tenant_quotas_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "library_sections_taTag_idx" ON "library_sections"("taTag");

-- CreateIndex
CREATE INDEX "library_sections_framework_idx" ON "library_sections"("framework");

-- CreateIndex
CREATE INDEX "library_sections_category_idx" ON "library_sections"("category");

-- CreateIndex
CREATE INDEX "library_sections_tenantId_isCurrent_idx" ON "library_sections"("tenantId", "isCurrent");

-- CreateIndex
CREATE INDEX "library_adoption_records_libraryId_idx" ON "library_adoption_records"("libraryId");

-- CreateIndex
CREATE INDEX "library_adoption_records_adoptingModule_adoptingEntity_idx" ON "library_adoption_records"("adoptingModule", "adoptingEntity");

-- CreateIndex
CREATE INDEX "notifications_recipientId_readAt_idx" ON "notifications"("recipientId", "readAt");

-- CreateIndex
CREATE INDEX "notifications_recipientId_createdAt_idx" ON "notifications"("recipientId", "createdAt");

-- CreateIndex
CREATE INDEX "notification_deliveries_notificationId_idx" ON "notification_deliveries"("notificationId");

-- CreateIndex
CREATE INDEX "notification_deliveries_channel_deliveredAt_idx" ON "notification_deliveries"("channel", "deliveredAt");

-- CreateIndex
CREATE UNIQUE INDEX "regulatory_frameworks_name_key" ON "regulatory_frameworks"("name");

-- CreateIndex
CREATE INDEX "regulatory_frameworks_jurisdiction_idx" ON "regulatory_frameworks"("jurisdiction");

-- CreateIndex
CREATE INDEX "regulatory_frameworks_category_idx" ON "regulatory_frameworks"("category");

-- CreateIndex
CREATE INDEX "raci_assignments_projectId_idx" ON "raci_assignments"("projectId");

-- CreateIndex
CREATE UNIQUE INDEX "raci_assignments_projectId_activity_key" ON "raci_assignments"("projectId", "activity");

-- CreateIndex
CREATE INDEX "ai_call_records_tenantId_createdAt_idx" ON "ai_call_records"("tenantId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_call_records_projectId_createdAt_idx" ON "ai_call_records"("projectId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_call_records_actorId_createdAt_idx" ON "ai_call_records"("actorId", "createdAt");

-- CreateIndex
CREATE INDEX "ai_call_records_module_createdAt_idx" ON "ai_call_records"("module", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ai_tenant_quotas_tenantId_key" ON "ai_tenant_quotas"("tenantId");

-- AddForeignKey
ALTER TABLE "notification_deliveries" ADD CONSTRAINT "notification_deliveries_notificationId_fkey" FOREIGN KEY ("notificationId") REFERENCES "notifications"("id") ON DELETE CASCADE ON UPDATE CASCADE;

