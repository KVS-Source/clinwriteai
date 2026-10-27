-- TKT-A-001 · ICH E3 Validator — waiver model.
--
-- Per-document, per-section amber "waived" marker (FR-A-026). The
-- validator endpoint joins this table to the document's section rows
-- to compute status; waived items render with reviewer + reason + date
-- in the right-rail panel and in the exported compliance report.
--
-- One row per (document, sectionCode). Unwaiving = delete + audit event.

CREATE TABLE "ich_section_waivers" (
  "id"               TEXT         NOT NULL,
  "documentId"       TEXT         NOT NULL,
  "sectionCode"      TEXT         NOT NULL,
  "waivedBy"         TEXT         NOT NULL,
  "waivedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "reason"           TEXT         NOT NULL,
  "versionAtWaiver"  TEXT         NOT NULL,

  CONSTRAINT "ich_section_waivers_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ich_section_waivers_documentId_sectionCode_key"
  ON "ich_section_waivers" ("documentId", "sectionCode");

CREATE INDEX "ich_section_waivers_documentId_idx"
  ON "ich_section_waivers" ("documentId");

ALTER TABLE "ich_section_waivers"
  ADD CONSTRAINT "ich_section_waivers_documentId_fkey"
  FOREIGN KEY ("documentId") REFERENCES "documents"("id")
  ON DELETE CASCADE ON UPDATE CASCADE;
