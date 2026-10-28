-- Backfill Document.assigneeId into document_raci as a letter='R' row
-- for every doc that doesn't already have one.
--
-- Per docs/roles-and-permissions.md §8:
--   "Existing assigneeId on Document migrates to a document_raci row
--    with letter 'R', section_id NULL."
--
-- Idempotent: only inserts rows where none exists today. Safe to run
-- on an already-partially-backfilled DB. Also safe to re-run — the
-- unique index on (documentId, userId, letter, sectionId) would
-- block duplicate attempts anyway.
--
-- After this migration, the actorCanEditDocumentRaci() helper no longer
-- needs the Document.assigneeId bootstrap branch for existing docs —
-- every doc has an authoritative R row. The branch stays for new docs
-- being created before the DocumentRaci row is inserted, which is a
-- different race condition.

INSERT INTO "document_raci" (
  "id", "documentId", "userId", "letter", "sectionId", "approvalOrder",
  "signatureRequired", "signatureMeaning",
  "submittedAt", "reviewedAt", "approvedAt", "signatureId",
  "rejectedAt", "rejectionNote",
  "assignedBy", "assignedAt", "removedAt"
)
SELECT
  -- CUID-like id from gen_random_uuid; the Prisma @default(cuid()) applies
  -- only on inserts via the Prisma client, so we hand-generate for the SQL path.
  'cu' || replace(gen_random_uuid()::text, '-', '') AS id,
  d."id"           AS "documentId",
  d."assigneeId"   AS "userId",
  'R'              AS "letter",
  NULL             AS "sectionId",
  NULL             AS "approvalOrder",
  FALSE            AS "signatureRequired",
  NULL             AS "signatureMeaning",
  NULL             AS "submittedAt",
  NULL             AS "reviewedAt",
  NULL             AS "approvedAt",
  NULL             AS "signatureId",
  NULL             AS "rejectedAt",
  NULL             AS "rejectionNote",
  COALESCE(d."createdBy", d."assigneeId") AS "assignedBy",
  d."createdAt"    AS "assignedAt",
  NULL             AS "removedAt"
FROM "documents" d
WHERE d."deletedAt" IS NULL
  AND d."assigneeId" IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM "document_raci" r
    WHERE r."documentId" = d."id"
      AND r."userId"     = d."assigneeId"
      AND r."letter"     = 'R'
      AND r."sectionId" IS NULL
      AND r."removedAt" IS NULL
  );
