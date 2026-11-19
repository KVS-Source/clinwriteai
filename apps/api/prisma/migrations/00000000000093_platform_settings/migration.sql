-- Platform-wide Branding + Localisation settings (Phase 3 of the admin
-- consolidation). Single-row table — the install has one brand identity
-- and one default locale. IT admin edits via Settings → Branding +
-- Settings → Localisation.
--
-- Branding JSON shape:
--   { companyName, primaryColor, logoUrl, emailFromName }
-- Localisation JSON shape:
--   { timezone, country, dateFormat, timeFormat, currency }
--
-- Shapes are validated by Zod at the API edge (see
-- apps/api/src/modules/platform/settings/schema.ts). The JSON column
-- keeps the migration simple + lets us add fields without another DDL.

CREATE TABLE "platform_settings" (
  "id"           TEXT        PRIMARY KEY DEFAULT 'default',
  "branding"     JSONB       NOT NULL DEFAULT '{}',
  "localisation" JSONB       NOT NULL DEFAULT '{}',
  "updatedBy"    TEXT,
  "updatedAt"    TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  -- Enforce single-row: only 'default' is ever written.
  CONSTRAINT "platform_settings_singleton_check" CHECK ("id" = 'default')
);

-- Seed the single row with sensible defaults so GET never has to
-- fabricate values. First-write UPSERT on the id='default' row covers
-- subsequent updates; re-running this migration (unlikely but safe) is
-- a no-op thanks to ON CONFLICT.
INSERT INTO "platform_settings" ("id", "branding", "localisation")
VALUES (
  'default',
  '{"companyName": "ClinWrite.AI", "primaryColor": "#2563EB"}',
  '{"timezone": "UTC", "country": "US", "dateFormat": "yyyy-MM-dd"}'
)
ON CONFLICT ("id") DO NOTHING;
