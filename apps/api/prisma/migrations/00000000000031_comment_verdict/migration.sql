-- Comment.verdict — Phase 2.2 of docs/pivot-plan.md Module A hardening.
--
-- Reviewer actions (Approve / Request changes / Block approval) are
-- modelled as a non-null verdict on a Comment row rather than a parallel
-- ReviewAction entity. See docs/decisions/module-a-defaults.md §3.

ALTER TABLE "comments" ADD COLUMN "verdict" TEXT;

CREATE INDEX "comments_documentId_verdict_idx" ON "comments"("documentId", "verdict");
