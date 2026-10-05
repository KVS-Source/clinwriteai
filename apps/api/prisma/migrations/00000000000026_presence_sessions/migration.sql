-- Module A §10 — section-level presence sessions (REST-polling layer; Socket.io
-- push + Redis fanout is a follow-up).
-- audit_events DROP filtered per ADR 0002.


-- CreateTable
CREATE TABLE "presence_sessions" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sectionId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "heartbeatAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "presence_sessions_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "presence_sessions_documentId_idx" ON "presence_sessions"("documentId");

-- CreateIndex
CREATE INDEX "presence_sessions_documentId_status_idx" ON "presence_sessions"("documentId", "status");

-- CreateIndex
CREATE INDEX "presence_sessions_userId_idx" ON "presence_sessions"("userId");
