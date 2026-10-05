-- Initial migration — enables required Postgres extensions.
-- Phase 1 Week 3 fleshes this out with the Platform-layer tables; Prisma
-- generates most of them from the schema/*.prisma files.

CREATE EXTENSION IF NOT EXISTS pgcrypto;    -- for gen_random_uuid()
CREATE EXTENSION IF NOT EXISTS "uuid-ossp"; -- legacy; drop later if unused
CREATE EXTENSION IF NOT EXISTS vector;      -- pgvector (per ADR 0003)

-- Timezone discipline: everything stored as timestamptz; app layer formats on read.
SET timezone = 'UTC';
