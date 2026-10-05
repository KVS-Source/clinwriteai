-- Seed the therapeutic_areas catalogue with a conservative starter list.
-- Codes follow the convention ONC, ONC-HAEM etc. established in the schema.
-- The medical writing lead can expand this via POST /admin/taxonomy/therapeutic-areas.
--
-- createdBy = 'system' — bypasses the FK-to-users check (createdBy is a
-- plain TEXT column, not an FK, so this is safe).
--
-- All rows pinned with the same createdAt + updatedAt (now()) at migration time.
-- audit_events DROP filtered per ADR 0002.

INSERT INTO "therapeutic_areas" ("code", "label", "parentCode", "status", "description", "createdBy", "createdAt", "updatedAt")
VALUES
  -- Top-level TAs
  ('ONC',  'Oncology',                NULL, 'active', 'Cancer and oncology-related therapeutics', 'system', NOW(), NOW()),
  ('CARD', 'Cardiovascular',          NULL, 'active', 'Heart and vascular diseases',               'system', NOW(), NOW()),
  ('NEU',  'Neurology',               NULL, 'active', 'Nervous system disorders',                  'system', NOW(), NOW()),
  ('IMM',  'Immunology',              NULL, 'active', 'Immune-mediated and autoimmune diseases',   'system', NOW(), NOW()),
  ('INF',  'Infectious diseases',     NULL, 'active', 'Viral, bacterial, and parasitic infections','system', NOW(), NOW()),
  ('END',  'Endocrinology',           NULL, 'active', 'Metabolic and hormonal disorders',          'system', NOW(), NOW()),
  ('RSP',  'Respiratory',             NULL, 'active', 'Pulmonary and respiratory disorders',       'system', NOW(), NOW()),
  ('RAR',  'Rare diseases',           NULL, 'active', 'Orphan drug / rare disease indications',    'system', NOW(), NOW()),
  ('OPH',  'Ophthalmology',           NULL, 'active', 'Eye and vision disorders',                  'system', NOW(), NOW()),
  ('DER',  'Dermatology',             NULL, 'active', 'Skin disorders',                            'system', NOW(), NOW()),
  -- Oncology sub-areas (illustrative — the lead will refine)
  ('ONC-HAEM',  'Haematologic malignancies',  'ONC',  'active', 'Leukaemia, lymphoma, multiple myeloma', 'system', NOW(), NOW()),
  ('ONC-SOLID', 'Solid tumours',              'ONC',  'active', 'All non-haematologic cancers',          'system', NOW(), NOW()),
  -- Cardiovascular sub-areas
  ('CARD-HTN',  'Hypertension',               'CARD', 'active', 'Blood pressure disorders',              'system', NOW(), NOW()),
  ('CARD-HF',   'Heart failure',              'CARD', 'active', 'Chronic + acute heart failure',         'system', NOW(), NOW())
ON CONFLICT ("code") DO NOTHING;
