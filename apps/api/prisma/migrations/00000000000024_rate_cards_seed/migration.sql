-- Seed rate card v1 from the in-code RATES array (apps/api/src/modules/
-- platform/ai-gateway/rate-card.ts). After this runs the DB-backed card
-- becomes the source of truth; the in-code RATES stays as a static
-- fallback for test contexts without a DB.
--
-- Idempotent: ON CONFLICT DO NOTHING so re-running the migration against
-- a DB that already has v1 is a no-op.
-- audit_events DROP filtered per ADR 0002.

INSERT INTO "rate_card_versions" ("id", "version", "publishedBy", "publishedAt", "isActive", "notes")
VALUES
  ('00000000-0000-0000-0000-000000000001', 'v1', 'system', NOW(), true,
   'Initial rate card seeded from in-code RATES array. Published 2026-10-05.')
ON CONFLICT ("version") DO NOTHING;

INSERT INTO "rate_card_entries" ("id", "rateCardVersionId", "model", "inputPer1M", "outputPer1M", "cachedInputPer1M")
VALUES
  ('00000000-0000-0000-0000-000000000011', '00000000-0000-0000-0000-000000000001', 'claude-opus-4-7',          15.00,  75.00,  1.50),
  ('00000000-0000-0000-0000-000000000012', '00000000-0000-0000-0000-000000000001', 'claude-sonnet-4-6',         3.00,  15.00,  0.30),
  ('00000000-0000-0000-0000-000000000013', '00000000-0000-0000-0000-000000000001', 'claude-haiku-4-5-20251001', 0.80,   4.00,  0.08),
  ('00000000-0000-0000-0000-000000000014', '00000000-0000-0000-0000-000000000001', 'unknown',                   5.00,  25.00,  0.50)
ON CONFLICT ("rateCardVersionId", "model") DO NOTHING;
