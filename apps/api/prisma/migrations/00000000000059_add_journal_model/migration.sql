-- Target-journal catalogue for JournalSubmissionReadiness (Scientific
-- Writing). Replaces the inline JOURNALS array that used to live in the
-- component. Static reference data — platform-wide, not tenant-scoped.
--
-- scope is a free-text tag ("oncology", "general-medicine", …) used for
-- coarse filtering today; richer taxonomy is deferred. impactFactor /
-- acceptanceRate / timeToDecision are nullable so we can seed entries
-- that have not yet published the figure publicly.

CREATE TABLE "journals" (
  "id"                      TEXT    PRIMARY KEY,
  "name"                    TEXT    NOT NULL,
  "abbreviation"            TEXT    NOT NULL,
  "impactFactor"            DOUBLE PRECISION,
  "acceptanceRate"          DOUBLE PRECISION,
  "timeToDecision"          INTEGER,
  "isICMJE"                 BOOLEAN NOT NULL DEFAULT false,
  "isEQUATOR"               BOOLEAN NOT NULL DEFAULT false,
  "scope"                   TEXT,
  "submissionGuidelinesUrl" TEXT,
  "createdAt"               TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"               TIMESTAMP(3) NOT NULL
);

CREATE INDEX "journals_scope_idx"   ON "journals"("scope");
CREATE INDEX "journals_isICMJE_idx" ON "journals"("isICMJE");
