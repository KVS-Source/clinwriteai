-- The study fact sheet of an AI-drafted document: the key facts the drafter extracted from the evidence sources,
-- each with the file, page and exact quote it came from, and whether code found that quote in the source. Every
-- section is drafted with these values. Written by the worker at the start of a draft that follows a build plan
-- with a fact sheet; NULL otherwise. Rollback = DROP COLUMN.

ALTER TABLE "documents"
  ADD COLUMN "fact_sheet" JSONB;
