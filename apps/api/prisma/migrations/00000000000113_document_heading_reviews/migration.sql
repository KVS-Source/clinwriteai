-- Main-heading introductions (documents/heading-intro.ts): when someone chose "Keep as it is" for a flagged heading,
-- { <sectionId>: { keptAt, keptBy } }. The heading is flagged again only when one of its sub-sections changes after
-- that. NULL / missing key = never decided. Rollback = DROP COLUMN.

ALTER TABLE "documents"
  ADD COLUMN "heading_reviews" JSONB;
