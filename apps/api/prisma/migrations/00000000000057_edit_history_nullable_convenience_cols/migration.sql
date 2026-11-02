-- Edit-history convenience columns — relax NOT NULL (2026-11-02).
--
-- Fixes a schema/code drift introduced by migration 39
-- (edit_history_polymorphic):
--
--   • Migration 38 created section_edit_history.documentId / sectionId /
--     documentVersionId as NOT NULL (clinical-only table at the time).
--   • Migration 39 renamed the table to edit_history and introduced the
--     polymorphic entityType + entityId pair, intending the three
--     original columns to be "convenience" fields populated only when
--     entityType='clinical_section'. The migration updated Prisma's
--     schema to String? but DID NOT relax the DB NOT NULL — the only
--     callers at the time were clinical-section writers so the drift
--     went unnoticed.
--   • Today: apps/worker/src/jobs/ai-initial-draft.ts tripped the
--     NOT NULL via tx.editHistory.create(…) and failed every section:
--     "Null constraint violation on the fields: (documentId)".
--     Side-effect: documents created with the "Draft with AI" opt-in
--     ended up with no AI-written sections — the writer sees the
--     Module A stub placeholder (preserved by the "skip non-empty"
--     guard) even though the key was configured and the worker ran.
--
-- Also unblocks future non-clinical entity types (peer_review_response,
-- ha_response_draft, slide, atomised_content) which were going to hit
-- the same wall the first time they tried to write a row.
--
-- All three columns stay in the schema — they're a valid index path for
-- Module A ("find all edits on this doc + section"). They're just no
-- longer required.

ALTER TABLE "edit_history"
  ALTER COLUMN "documentId"         DROP NOT NULL,
  ALTER COLUMN "sectionId"          DROP NOT NULL,
  ALTER COLUMN "documentVersionId"  DROP NOT NULL;
