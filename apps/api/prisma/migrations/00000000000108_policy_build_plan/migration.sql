-- The AI build plan of a document type (the order sections are drafted in, what each depends on, and the
-- drafting rules), and where it came from. Set only by importing a signed policy package from GenBioCa
-- (docs/policy-packages.md); PMs can't edit it. NULL = no plan: the document type drafts as before.
-- A new policy version carries the plan forward. Rollback = DROP COLUMN on both.

ALTER TABLE "document_type_policies"
  ADD COLUMN "buildPlan"       JSONB,
  ADD COLUMN "buildPlanSource" JSONB;
