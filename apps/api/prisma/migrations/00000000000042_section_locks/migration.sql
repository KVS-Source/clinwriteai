-- Section-level advisory lock for the autosave flow (sPM-autosave).
-- One holder per (documentId, sectionId) at a time. Lease-based: the
-- client heartbeats every ~30s to keep the lock alive, and a lock whose
-- lastHeartbeatAt is older than SECTION_LOCK_STALE_SECONDS (default 90s)
-- is considered dead and can be stolen by another acquirer.
--
-- Why UNIQUE on (documentId, sectionId) rather than a reaper table +
-- status column: the lock is binary (held / not held) and we want hard
-- Postgres enforcement on concurrent POST /lock to prevent two users
-- both believing they hold the lock during the race window. The reaper
-- is just a scheduled DELETE on stale rows; the acquire path does its
-- own stale-steal in a transaction so correctness doesn't depend on it.

CREATE TABLE "section_locks" (
  "id"               TEXT         NOT NULL,
  "documentId"       TEXT         NOT NULL,
  "sectionId"        TEXT         NOT NULL,
  "userId"           TEXT         NOT NULL,
  "acquiredAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastHeartbeatAt"  TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "section_locks_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "section_locks_doc_sec_unique"
  ON "section_locks" ("documentId", "sectionId");

CREATE INDEX "section_locks_userId_idx"
  ON "section_locks" ("userId");

CREATE INDEX "section_locks_lastHeartbeatAt_idx"
  ON "section_locks" ("lastHeartbeatAt");
