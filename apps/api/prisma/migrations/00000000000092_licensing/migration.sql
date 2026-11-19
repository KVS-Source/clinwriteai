-- Licensing — per-install token model.
--
-- Each customer install is issued a signed JWT by GenBioCa HQ containing
-- the modules + features they're licensed for. IT admins import the token
-- on the Settings → Licensing tab. The server re-verifies the JWT on
-- every read using an embedded GenBioCa public key — the DB row is
-- UNTRUSTED (customer has DB access on self-hosted installs). Only what's
-- inside the signed token is authoritative.
--
-- Columns that look like trusted data (modulesSnapshot, featuresSnapshot)
-- are DISPLAY-ONLY caches so the admin UI can render without parsing on
-- every request. The auth path never reads them.

CREATE TABLE "licenses" (
  "id"               TEXT        PRIMARY KEY,

  -- Raw signed JWT — the only authoritative module/feature list. On
  -- every read the server re-verifies the signature + decodes the
  -- payload. If a customer tampered with this value, verification fails
  -- and the install effectively loses its license (safe default: no
  -- modules enabled → service unavailable with an explanatory error).
  "token"            TEXT        NOT NULL,

  -- Display-only cache, populated at import time from the decoded JWT.
  -- Not trusted by auth — authorization always re-decodes `token`.
  "installId"        TEXT        NOT NULL,
  "customerName"     TEXT        NOT NULL,
  "issuedAt"         TIMESTAMP(3) NOT NULL,
  "expiry"           TIMESTAMP(3) NOT NULL,
  "modulesSnapshot"  TEXT[]      NOT NULL DEFAULT '{}',
  "featuresSnapshot" TEXT[]      NOT NULL DEFAULT '{}',

  -- Breadcrumbs for audit trail.
  "importedBy"       TEXT        NOT NULL,
  "importedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  "isActive"         BOOLEAN     NOT NULL DEFAULT false,
  "revokedAt"        TIMESTAMP(3),
  "revokedBy"        TEXT,
  "revokeReason"     TEXT
);

-- Exactly one active row at a time. Importing a new token flips the
-- previous active row to inactive atomically in the service layer.
CREATE UNIQUE INDEX "licenses_single_active_idx"
  ON "licenses"("isActive") WHERE "isActive" = true;

CREATE INDEX "licenses_importedAt_idx"  ON "licenses"("importedAt");
CREATE INDEX "licenses_installId_idx"   ON "licenses"("installId");
