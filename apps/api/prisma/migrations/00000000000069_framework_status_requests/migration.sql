-- Framework supersede requests (2026-11-13).
--
-- Marking a regulatory framework superseded is a two-person decision: a Project Manager sends it for
-- approval, and another PM or a QC approves (the framework is then retired) or rejects it with a reason.
-- One row per request; at most one pending request per framework (partial unique index).
-- Additive only: no existing table or row changes.

CREATE TABLE "framework_status_requests" (
    "id"               TEXT NOT NULL,
    "framework_id"     TEXT NOT NULL,
    "requested_by"     TEXT NOT NULL,
    "requested_at"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reason"           TEXT,
    "status"           TEXT NOT NULL DEFAULT 'pending',      -- pending | approved | rejected
    "decided_by"       TEXT,
    "decided_at"       TIMESTAMP(3),
    "rejection_reason" TEXT,

    CONSTRAINT "framework_status_requests_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "framework_status_requests_framework_id_fkey" FOREIGN KEY ("framework_id")
        REFERENCES "regulatory_frameworks"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "framework_status_requests_framework_id_idx" ON "framework_status_requests"("framework_id");
CREATE INDEX "framework_status_requests_status_idx" ON "framework_status_requests"("status");
CREATE UNIQUE INDEX "framework_status_requests_one_pending" ON "framework_status_requests"("framework_id") WHERE "status" = 'pending';
