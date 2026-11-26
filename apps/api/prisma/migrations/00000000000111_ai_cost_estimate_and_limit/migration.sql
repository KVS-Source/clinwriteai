-- AI cost estimate and limit (New Document).
--   document_type_policies."costEstimateEnabled": the PM turns on the cost estimate for a document type (off by
--   default). When on, New Document shows the estimated AI drafting cost and the PM may set a limit.
--   documents.ai_cost_limit: that limit, { usd, amount, currency, usdRate, setBy, setAt }; the worker pauses the
--   draft when the next call would go over it. NULL = no limit.
-- Rollback = DROP COLUMN on both.

ALTER TABLE "document_type_policies"
  ADD COLUMN "costEstimateEnabled" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "documents"
  ADD COLUMN "ai_cost_limit" JSONB;
