-- Whether a PM may set an AI drafting cost limit at New Document for this document type (off by default). Separate
-- from costEstimateEnabled (showing the estimate). When on, the limit is set when the document is created; a draft
-- that reaches it pauses, the project managers are notified, and a PM raises the limit in AI Debug to continue.
-- Rollback = DROP COLUMN.

ALTER TABLE "document_type_policies"
  ADD COLUMN "costLimitEnabled" BOOLEAN NOT NULL DEFAULT false;
