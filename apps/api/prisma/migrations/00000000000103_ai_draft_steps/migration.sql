-- Fine-grained step log for the AI drafter.
--
-- WHY:
--   The audit_events table and ai_section_draft_traces capture the
--   coarse milestones (enqueued, section committed, validation done)
--   but can't answer "where exactly did it stop?" when a draft hangs
--   or produces something unexpected. Writers asked for a verbose
--   play-by-play so they can see things like "source X loaded Y
--   bytes, extracted Z chars", "section 1.1 TBDs: 3", "validation
--   pass 2 flagged §6.3" and spot the broken step at a glance.
--
-- SHAPE:
--   One row per worker step. BIGSERIAL id so inserts are cheap and
--   there's no FK cascade on the hot path (document rows can be hard-
--   deleted without needing to update the step log). `kind` is a
--   discriminator (policy_loaded, section_start, tbd_detected, …);
--   `message` is the one-line human text the UI renders; `details`
--   carries structured extras (char counts, model name, section id,
--   token budget) so the panel can drill in without a separate query.
--
-- Retention: no TTL today — a full draft writes a few hundred rows,
-- which at typical volumes is negligible. Follow-up can add a
-- scheduled prune (keep last N per document) once the panel sees
-- real usage.

CREATE TABLE "ai_draft_steps" (
  "id"         BIGSERIAL PRIMARY KEY,
  "documentId" TEXT NOT NULL,
  "versionId"  TEXT,
  "kind"       TEXT NOT NULL,
  "message"    TEXT NOT NULL,
  "sectionId"  TEXT,
  "details"    JSONB NOT NULL DEFAULT '{}'::jsonb,
  "elapsedMs"  INTEGER,
  "timestamp"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "ai_draft_steps_doc_ts_idx"
  ON "ai_draft_steps" ("documentId", "timestamp");
