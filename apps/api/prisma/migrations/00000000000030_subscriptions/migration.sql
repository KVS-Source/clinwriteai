-- Per-tenant subscription + rate-card linkage (pivot-plan Arc 8.4).

CREATE TABLE "subscriptions" (
  "id"                TEXT         NOT NULL,
  "tenantId"          TEXT         NOT NULL,
  "plan"              TEXT         NOT NULL,
  "monthlyCapUsd"     DECIMAL(10, 2) NOT NULL,
  "rolloverDay"       INTEGER      NOT NULL DEFAULT 1,
  "rateCardVersionId" TEXT,
  "startedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "endedAt"           TIMESTAMP(3),
  "createdBy"         TEXT         NOT NULL,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL,
  "notes"             TEXT,

  CONSTRAINT "subscriptions_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "subscriptions_tenantId_endedAt_idx" ON "subscriptions"("tenantId", "endedAt");
CREATE INDEX "subscriptions_rateCardVersionId_idx" ON "subscriptions"("rateCardVersionId");
