-- Document templates — section skeleton + source-category rules per
-- document type. See platform-services.prisma model DocumentTemplate
-- for the business model + apps/api/prisma/seed/document-templates.ts
-- for the seed script that fills this table on deploy.
--
-- The sections column holds JSONB:
--   [{ "id": "s1", "number": "§1", "title": "Title Page", "usOnly": false }, ...]
-- The requiredSourceCategories column holds a TEXT[] of
-- utils/sourceCategories.ts value keys ('protocol', 'sap', 'tlf', ...).
--
-- Why on-disk SQL instead of a prisma migrate dev auto-gen:
--   - Keeps the migration file reviewable + deterministic (no shadow DB).
--   - Lets us seed canonical rows in the same migration so demo deploys
--     light up the wizard immediately without a separate seed step.
--     (The seed step still exists for apps/api/prisma/seed.ts callers
--     who want to re-apply after a schema reset.)

CREATE TABLE "document_templates" (
  "id"                        TEXT PRIMARY KEY,
  "type"                      TEXT NOT NULL,
  "label"                     TEXT NOT NULL,
  "description"               TEXT NOT NULL,
  "framework"                 TEXT NOT NULL,
  "sections"                  JSONB NOT NULL,
  "requiredSourceCategories"  TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "version"                   INTEGER NOT NULL DEFAULT 1,
  "isCurrent"                 BOOLEAN NOT NULL DEFAULT TRUE,
  "supersededBy"              TEXT,
  "retiredAt"                 TIMESTAMP(3),
  "createdBy"                 TEXT NOT NULL,
  "createdAt"                 TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"                 TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE INDEX "document_templates_type_isCurrent_idx"
  ON "document_templates" ("type", "isCurrent");

-- One active template per type at a time. Historical / superseded rows
-- can share the type with isCurrent=false, so the partial unique index
-- enforces current-only distinctness.
CREATE UNIQUE INDEX "document_templates_type_current_unique"
  ON "document_templates" ("type") WHERE "isCurrent" = TRUE;
