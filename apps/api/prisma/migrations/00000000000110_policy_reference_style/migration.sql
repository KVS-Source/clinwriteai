-- How references are cited in documents of this type when code builds the References section (worker
-- finishing.ts): 'numbered' ([1], list in order of first use) or 'author_year' ((Smith 2021), list alphabetical).
-- Set by the PM on the policy. Rollback = DROP COLUMN.

ALTER TABLE "document_type_policies"
  ADD COLUMN "referenceStyle" TEXT NOT NULL DEFAULT 'numbered';
