-- Module A CRM workflow — meetings + attendees + resolutions (data model §11).
-- audit_events DROP filtered per ADR 0002.


-- CreateTable
CREATE TABLE "crm_meetings" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "meetingRef" TEXT NOT NULL,
    "chairId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'scheduled',
    "scheduledDate" DATE NOT NULL,
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "startedAt" TIMESTAMP(3),
    "endedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_meetings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_attendees" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "roleInCrm" TEXT NOT NULL,
    "joinedAt" TIMESTAMP(3),

    CONSTRAINT "crm_attendees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "crm_resolutions" (
    "id" TEXT NOT NULL,
    "meetingId" TEXT NOT NULL,
    "commentId" TEXT NOT NULL,
    "resolutionType" TEXT NOT NULL,
    "resolutionNote" TEXT NOT NULL,
    "resolvedBy" TEXT NOT NULL,
    "resolvedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "crm_resolutions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "crm_meetings_meetingRef_key" ON "crm_meetings"("meetingRef");

-- CreateIndex
CREATE INDEX "crm_meetings_documentId_idx" ON "crm_meetings"("documentId");

-- CreateIndex
CREATE INDEX "crm_attendees_meetingId_idx" ON "crm_attendees"("meetingId");

-- CreateIndex
CREATE UNIQUE INDEX "crm_attendees_meetingId_userId_key" ON "crm_attendees"("meetingId", "userId");

-- CreateIndex
CREATE INDEX "crm_resolutions_meetingId_idx" ON "crm_resolutions"("meetingId");

-- CreateIndex
CREATE INDEX "crm_resolutions_commentId_idx" ON "crm_resolutions"("commentId");

-- CreateIndex
CREATE UNIQUE INDEX "crm_resolutions_meetingId_commentId_key" ON "crm_resolutions"("meetingId", "commentId");

-- AddForeignKey
ALTER TABLE "crm_attendees" ADD CONSTRAINT "crm_attendees_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "crm_meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "crm_resolutions" ADD CONSTRAINT "crm_resolutions_meetingId_fkey" FOREIGN KEY ("meetingId") REFERENCES "crm_meetings"("id") ON DELETE CASCADE ON UPDATE CASCADE;

