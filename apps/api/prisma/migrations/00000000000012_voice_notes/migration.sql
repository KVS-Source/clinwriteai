-- voice_notes table — Module A audio notes per FR §7.1.
-- audit_events DROP filtered per ADR 0002.


-- CreateTable
CREATE TABLE "voice_notes" (
    "id" TEXT NOT NULL,
    "documentId" TEXT NOT NULL,
    "sectionRef" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "audioBlobKey" TEXT NOT NULL,
    "audioRegion" TEXT NOT NULL DEFAULT 'us-east-1',
    "transcript" TEXT NOT NULL DEFAULT '',
    "transcriptStatus" TEXT NOT NULL DEFAULT 'pending',
    "durationSeconds" INTEGER,
    "transcriptionEngine" TEXT,
    "insertedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "voice_notes_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "voice_notes_documentId_idx" ON "voice_notes"("documentId");

-- CreateIndex
CREATE INDEX "voice_notes_documentId_sectionRef_idx" ON "voice_notes"("documentId", "sectionRef");

