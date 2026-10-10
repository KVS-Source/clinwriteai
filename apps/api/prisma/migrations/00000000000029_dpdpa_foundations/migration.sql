-- DPDPA 2023 foundations (pivot-plan Arc 7).
--
-- Adds data_residency + DPO fields to tenants; creates consent_records
-- (immutable), data_principal_requests (admin inbox), and
-- allowed_transfer_jurisdictions (cross-border allow-list).
--
-- See docs/pivot-plan.md Arc 7 and docs/PRD_A_Clinical_Writing_v0_4.md
-- §8.1 / §8.3 / §10 for scope. Semantics intentionally match the GDPR
-- right-to-erasure pipeline in Module A (content delete, hash preserve).

ALTER TABLE "tenants"
  ADD COLUMN "dataResidency" TEXT NOT NULL DEFAULT 'EU',
  ADD COLUMN "dpoName"       TEXT,
  ADD COLUMN "dpoEmail"      TEXT,
  ADD COLUMN "dpoPhone"      TEXT,
  ADD COLUMN "isSdf"         BOOLEAN NOT NULL DEFAULT false;

CREATE INDEX "tenants_dataResidency_idx" ON "tenants"("dataResidency");

-- Verifiable consent records (DPDPA §6). Immutable at the API layer;
-- supersession happens by inserting a new row + revoking the old.
CREATE TABLE "consent_records" (
  "id"                      TEXT         NOT NULL,
  "tenantId"                TEXT         NOT NULL,
  "subjectType"             TEXT         NOT NULL,
  "subjectId"               TEXT         NOT NULL,
  "purpose"                 TEXT         NOT NULL,
  "scope"                   TEXT[]       NOT NULL DEFAULT ARRAY[]::TEXT[],
  "consentManagerReference" TEXT,
  "capturedVia"             TEXT         NOT NULL,
  "capturedAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt"               TIMESTAMP(3),
  "revocationReason"        TEXT,

  CONSTRAINT "consent_records_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "consent_records"
  ADD CONSTRAINT "consent_records_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "consent_records_tenantId_subjectType_subjectId_idx"
  ON "consent_records"("tenantId", "subjectType", "subjectId");
CREATE INDEX "consent_records_tenant_subject_purpose_revoked_idx"
  ON "consent_records"("tenantId", "subjectType", "subjectId", "purpose", "revokedAt");

-- Data Principal rights requests (DPDPA §13).
CREATE TABLE "data_principal_requests" (
  "id"                  TEXT         NOT NULL,
  "tenantId"            TEXT         NOT NULL,
  "subjectType"         TEXT         NOT NULL,
  "subjectId"           TEXT         NOT NULL,
  "subjectEmail"        TEXT         NOT NULL,
  "requestType"         TEXT         NOT NULL,
  "status"              TEXT         NOT NULL DEFAULT 'received',
  "slaDueAt"            TIMESTAMP(3) NOT NULL,
  "details"             TEXT         NOT NULL,
  "assignedToUserId"    TEXT,
  "resolutionNote"      TEXT,
  "fulfilledAt"         TIMESTAMP(3),
  "erasureAuditEventId" TEXT,
  "createdAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"           TIMESTAMP(3) NOT NULL,

  CONSTRAINT "data_principal_requests_pkey" PRIMARY KEY ("id")
);

ALTER TABLE "data_principal_requests"
  ADD CONSTRAINT "data_principal_requests_tenantId_fkey"
    FOREIGN KEY ("tenantId") REFERENCES "tenants"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

CREATE INDEX "data_principal_requests_tenantId_status_idx"
  ON "data_principal_requests"("tenantId", "status");
CREATE INDEX "data_principal_requests_tenantId_slaDueAt_idx"
  ON "data_principal_requests"("tenantId", "slaDueAt");

-- Cross-border transfer allow-list. Empty list = block all cross-border
-- transfer. Populated by operator from MeitY notifications.
CREATE TABLE "allowed_transfer_jurisdictions" (
  "code"          TEXT         NOT NULL,
  "displayName"   TEXT         NOT NULL,
  "addedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "addedByUserId" TEXT,
  "notes"         TEXT,

  CONSTRAINT "allowed_transfer_jurisdictions_pkey" PRIMARY KEY ("code")
);
