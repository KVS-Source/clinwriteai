-- Policy requirements rollout — Publication (B), Medical (C),
-- Regulatory (D), Ideation (E).
--
-- Migration 100 landed the same column on the clinical
-- document_type_policies table. This picks up the other four policy
-- tables so PMs can toggle required inputs per doc type on every
-- module, not just clinical. Shape + defaults identical to migration
-- 100 (all three flags default to true — matches prior behaviour).

ALTER TABLE "publication_type_policies"
  ADD COLUMN "requirements" JSONB NOT NULL
    DEFAULT '{"requireSources": true, "requireTemplate": true, "requirePurpose": true}'::jsonb;

ALTER TABLE "med_content_type_policies"
  ADD COLUMN "requirements" JSONB NOT NULL
    DEFAULT '{"requireSources": true, "requireTemplate": true, "requirePurpose": true}'::jsonb;

ALTER TABLE "regulatory_type_policies"
  ADD COLUMN "requirements" JSONB NOT NULL
    DEFAULT '{"requireSources": true, "requireTemplate": true, "requirePurpose": true}'::jsonb;

ALTER TABLE "ideation_type_policies"
  ADD COLUMN "requirements" JSONB NOT NULL
    DEFAULT '{"requireSources": true, "requireTemplate": true, "requirePurpose": true}'::jsonb;
