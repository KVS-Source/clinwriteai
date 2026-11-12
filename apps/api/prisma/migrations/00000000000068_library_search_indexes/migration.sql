-- Master Library search: make "contains" searches able to use an index.
--
-- The library list searches a document's title, its full text and its tags on every search:
--     title ILIKE '%q%'  OR  body ILIKE '%q%'  OR  tags @> ARRAY['q']
-- Without indexes that reads every row's whole text each time (a document can be hundreds of KB).
-- pg_trgm GIN indexes serve ILIKE '%…%' for terms of 3+ characters (the API only searches the text from
-- 3 characters on), and a GIN index on tags serves the array branch — the planner can only combine the
-- three branches with one index scan when every branch has an index.
--
-- Safe to run on a live database: it only adds indexes (plain CREATE INDEX holds a write lock on
-- library_sections while each one builds — the table is small; use CONCURRENTLY by hand for a very large one).
-- Needs the pg_trgm extension. In PostgreSQL 13+ it is a "trusted" extension, so the database owner can create it;
-- on an older or locked-down server a superuser must run  CREATE EXTENSION pg_trgm;  first.

CREATE EXTENSION IF NOT EXISTS "pg_trgm";

CREATE INDEX "library_sections_title_trgm_idx" ON "library_sections" USING GIN ("title" gin_trgm_ops);
CREATE INDEX "library_sections_body_trgm_idx"  ON "library_sections" USING GIN ("body" gin_trgm_ops);
CREATE INDEX "library_sections_tags_gin_idx"   ON "library_sections" USING GIN ("tags");
