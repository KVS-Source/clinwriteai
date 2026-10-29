-- Review due date chosen in the Submit-for-review panel (FR-A-042: "sets
-- review due dates"). Until now the API dropped it, so the Reviewer View
-- showed a hard-coded date. Nullable: documents never submitted, or
-- submitted before this migration, have no due date.
ALTER TABLE "documents" ADD COLUMN IF NOT EXISTS "reviewDueAt" TIMESTAMP(3);
