-- Initial migration — enables required Postgres extensions.
-- Phase 1 Week 3 fleshes this out with the Platform-layer tables; Prisma
-- generates most of them from the schema/*.prisma files.

CREATE EXTENSION IF NOT EXISTS pgcrypto;    -- for gen_random_uuid()

-- pgvector is DEFERRED to Phase 3C (Claims Matrix similarity engine).
-- Requires `sudo apt-get install postgresql-16-pgvector` on the host first.
-- When ready, add a new migration: migrations/<ts>_enable_pgvector/migration.sql
-- containing: CREATE EXTENSION IF NOT EXISTS vector;
-- Then re-enable the datasource `extensions = [pgvector(map: "vector")]` line
-- in prisma/schema/schema.prisma.

-- Timezone discipline: everything stored as timestamptz; app layer formats on read.
SET timezone = 'UTC';
