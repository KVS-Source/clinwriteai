-- AI Note-Taker for CRM meetings (Phase 1 — sPM-ai-notetaker).
--
-- Data stance (DPDPA + GDPR): audio is NEVER stored. The chair uploads
-- a pre-transcribed text (Zoom "Save transcript" / Teams export / Otter
-- today; Recall.ai bot in Phase 3). We keep only the transcript text and
-- the AI-generated artefacts (per-comment draft notes + minutes HTML).
--
-- Minutes HTML columns live on the existing crm_meetings table so the
-- generated minutes are discoverable from the same row as the meeting
-- itself. Transcript + draft notes are separate tables because they can
-- be re-generated independently and we want the chair to be able to
-- replace a transcript without rebuilding the meeting record.

-- ===== crm_meetings — minutes columns =====

ALTER TABLE "crm_meetings"
  ADD COLUMN "minutesHtml"         TEXT,
  ADD COLUMN "minutesGeneratedAt"  TIMESTAMP(3),
  ADD COLUMN "minutesGeneratedBy"  TEXT;

-- ===== crm_meeting_transcripts =====

CREATE TABLE "crm_meeting_transcripts" (
  "id"          TEXT         NOT NULL,
  "meetingId"   TEXT         NOT NULL,
  "rawText"     TEXT         NOT NULL,
  "wordCount"   INTEGER      NOT NULL,
  "source"      TEXT         NOT NULL DEFAULT 'manual_paste',
  "uploadedBy"  TEXT         NOT NULL,
  "uploadedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "crm_meeting_transcripts_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "crm_meeting_transcripts_meetingId_unique"
  ON "crm_meeting_transcripts" ("meetingId");

ALTER TABLE "crm_meeting_transcripts"
  ADD CONSTRAINT "crm_meeting_transcripts_meetingId_fkey"
  FOREIGN KEY ("meetingId") REFERENCES "crm_meetings"("id")
  ON DELETE CASCADE;

-- ===== crm_ai_draft_notes =====

CREATE TABLE "crm_ai_draft_notes" (
  "id"              TEXT         NOT NULL,
  "meetingId"       TEXT         NOT NULL,
  "commentId"       TEXT         NOT NULL,
  "draftText"       TEXT         NOT NULL,
  "aiModel"         TEXT         NOT NULL,
  "aiCallRecordId"  TEXT,
  "generatedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "crm_ai_draft_notes_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "crm_ai_draft_notes_meeting_comment_unique"
  ON "crm_ai_draft_notes" ("meetingId", "commentId");

CREATE INDEX "crm_ai_draft_notes_meetingId_idx"
  ON "crm_ai_draft_notes" ("meetingId");

ALTER TABLE "crm_ai_draft_notes"
  ADD CONSTRAINT "crm_ai_draft_notes_meetingId_fkey"
  FOREIGN KEY ("meetingId") REFERENCES "crm_meetings"("id")
  ON DELETE CASCADE;
