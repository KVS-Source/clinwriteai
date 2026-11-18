-- Phase M-C.7 — pgvector claim similarity (gated).
--
-- Behaviour contract for environments WITHOUT the pgvector extension
-- installed (CI test runners, bare dev boxes):
--   - This migration is a no-op. Nothing is created, no errors raised.
--   - Existing Jaccard similarity path keeps working unchanged.
--
-- Behaviour contract for environments WITH pgvector available:
--   - Extension is created (idempotent).
--   - `claims_matrix_items.embedding vector(1536)` column added.
--   - `library_sections.embedding vector(1536)` column added.
--   - HNSW cosine index created on both columns.
--
-- The `embedding` column stays outside the Prisma schema; all reads
-- go through `$queryRaw` in claim-embedding-service.ts so Prisma
-- generate works identically in both environments.
--
-- The whole thing is additionally gated at runtime by
-- FEATURE_PGVECTOR_CLAIMS=1 — the migration is "available for use"
-- when both the extension exists and the flag is set.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'vector') THEN
    EXECUTE 'CREATE EXTENSION IF NOT EXISTS "vector"';

    EXECUTE 'ALTER TABLE "claims_matrix_items" ADD COLUMN IF NOT EXISTS "embedding" vector(1536)';
    EXECUTE 'ALTER TABLE "library_sections"    ADD COLUMN IF NOT EXISTS "embedding" vector(1536)';

    -- HNSW is pgvector 0.5+. If the server only has IVF support the
    -- index creation will fail; swallow + log via NOTICE so the rest
    -- of the migration continues.
    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS "claims_matrix_items_embedding_hnsw_idx" ON "claims_matrix_items" USING hnsw ("embedding" vector_cosine_ops)';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'claims_matrix_items HNSW index skipped: %', SQLERRM;
    END;

    BEGIN
      EXECUTE 'CREATE INDEX IF NOT EXISTS "library_sections_embedding_hnsw_idx" ON "library_sections" USING hnsw ("embedding" vector_cosine_ops)';
    EXCEPTION WHEN OTHERS THEN
      RAISE NOTICE 'library_sections HNSW index skipped: %', SQLERRM;
    END;
  ELSE
    RAISE NOTICE 'pgvector extension not available on this server — skipping embedding column + index creation. Install postgresql-N-pgvector and re-run this migration to enable similarity search.';
  END IF;
END
$$;
