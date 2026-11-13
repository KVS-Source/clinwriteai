-- Master Library sharing with people who have no account (2026-11-13).
--
-- A Project Manager or Contributor can share a Master Document with someone outside the system (e.g. a CEO who
-- must read it). The emailed link alone opens nothing: the reader asks for a one-time code, which is emailed to
-- the invited address only, and the document shows after the code is entered. So a forwarded link is useless to
-- anyone without access to that inbox. Only hashes of the link token, the code and the viewing session are kept.
-- Additive only: no existing table or row changes.

CREATE TABLE "library_shares" (
    "id"               TEXT NOT NULL,
    "libraryItemId"    TEXT NOT NULL,
    "tenantId"         TEXT,
    "email"            TEXT NOT NULL,
    "sharedBy"         TEXT NOT NULL,
    "sharedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt"        TIMESTAMP(3) NOT NULL,
    "revokedAt"        TIMESTAMP(3),
    "tokenHash"        TEXT NOT NULL,
    "codeHash"         TEXT,
    "codeSentAt"       TIMESTAMP(3),
    "codeExpiresAt"    TIMESTAMP(3),
    "codeAttempts"     INTEGER NOT NULL DEFAULT 0,
    "codesSent"        INTEGER NOT NULL DEFAULT 0,
    "sessionHash"      TEXT,
    "sessionExpiresAt" TIMESTAMP(3),
    "lastOpenedAt"     TIMESTAMP(3),

    CONSTRAINT "library_shares_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "library_shares_tokenHash_key" ON "library_shares"("tokenHash");
CREATE INDEX "library_shares_libraryItemId_idx" ON "library_shares"("libraryItemId");
CREATE INDEX "library_shares_email_idx" ON "library_shares"("email");
