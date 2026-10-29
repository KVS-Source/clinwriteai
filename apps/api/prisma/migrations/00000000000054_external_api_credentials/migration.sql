-- External API credentials — admin-entered credentials for the regulatory /
-- publishing / messaging connectors shown on the Admin Panel's External APIs
-- tab. Replaces the in-memory draft map in web/AdminPanel.tsx so entries
-- survive a page reload.
--
-- See platform-services.prisma model ExternalApiCredential for the business
-- model + apps/api/.../external-api-credentials/routes.ts for the API shape.
--
-- apiKey + username + baseUrl + notes are nullable so partial updates don't
-- require clearing every field. The unique (tenantId, apiId) index means an
-- upsert on the API side can safely use that composite key.

CREATE TABLE "external_api_credentials" (
  "id"         TEXT PRIMARY KEY,
  "tenantId"   TEXT,
  "apiId"      TEXT NOT NULL,
  "apiKey"     TEXT,
  "username"   TEXT,
  "baseUrl"    TEXT,
  "notes"      TEXT,
  "updatedBy"  TEXT NOT NULL,
  "updatedAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- COALESCE in the index so platform-level rows (tenantId=NULL) also
-- enforce uniqueness per apiId. The plain (tenantId, apiId) UNIQUE
-- would allow multiple NULL-tenant rows for the same connector per
-- SQL's "NULL ≠ NULL" rule, which breaks "one row per connector".
-- Prisma won't surface this index as a composite key — upserts go
-- through findFirst + create/update explicitly (see routes.ts).
CREATE UNIQUE INDEX "external_api_credentials_tenant_api_unique"
  ON "external_api_credentials" (COALESCE("tenantId", 'platform'), "apiId");

CREATE INDEX "external_api_credentials_tenantId_idx"
  ON "external_api_credentials" ("tenantId");
