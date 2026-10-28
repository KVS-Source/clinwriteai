-- Unified RBAC / RACI schema — additive only.
--
-- Introduces the three tables + two columns needed for the role refactor
-- described in docs/roles-and-permissions.md. Does NOT change any existing
-- row values yet: User.role keeps its legacy strings until migration 48
-- flips them in lockstep with the rbac.ts rewrite. Everything here is
-- backwards-compatible with the current API.
--
--   users.capabilities      text[] NOT NULL DEFAULT '{}'   — [can-author|…]
--   users.legacy_role       text   NULL                     — snapshot kept 90d
--   project_members         new table  — ProjectMember      — §3.1
--   document_raci           new table  — DocumentRaci       — §3.2 + §4
--   guest_invitations       new table  — GuestInvitation    — §6
--
-- The guest_invitations CHECK constraint enforces exactly one of
-- (document_id, project_id) being set, matching the "scope" column.

-- ---------------------------------------------------------------------------
-- users: add capabilities + legacy_role columns.
-- ---------------------------------------------------------------------------
ALTER TABLE "users"
  ADD COLUMN "capabilities" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "legacy_role"  TEXT;

-- ---------------------------------------------------------------------------
-- project_members: project-level membership. Replaces loose use of
-- project_team_members for permission purposes. project_team_members is
-- left in place during cutover (see schema comment).
-- ---------------------------------------------------------------------------
CREATE TABLE "project_members" (
  "id"            TEXT PRIMARY KEY,
  "projectId"     TEXT NOT NULL,
  "userId"        TEXT NOT NULL,
  "projectRole"   TEXT,
  "addedBy"       TEXT NOT NULL,
  "addedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "removedAt"     TIMESTAMP(3),
  CONSTRAINT "project_members_project_fk"
    FOREIGN KEY ("projectId") REFERENCES "projects"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "project_members_user_fk"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE UNIQUE INDEX "project_members_project_user_unique"
  ON "project_members" ("projectId", "userId");
CREATE INDEX "project_members_project_idx" ON "project_members" ("projectId");
CREATE INDEX "project_members_user_idx"    ON "project_members" ("userId");

-- ---------------------------------------------------------------------------
-- document_raci: the authoritative per-document ACL.
--
-- Multi-user per letter. Section-scoped rows. Signatures first-class.
-- Capability match + "no self-review on same section" + "no whole-doc +
-- per-section" constraints are enforced in the service layer, not here —
-- the DB only enforces the uniqueness bound.
-- ---------------------------------------------------------------------------
CREATE TABLE "document_raci" (
  "id"                   TEXT PRIMARY KEY,
  "documentId"           TEXT NOT NULL,
  "userId"               TEXT NOT NULL,
  "letter"               TEXT NOT NULL,
  "sectionId"            TEXT,
  "approvalOrder"        INTEGER,

  "signatureRequired"    BOOLEAN NOT NULL DEFAULT FALSE,
  "signatureMeaning"     TEXT,

  "submittedAt"          TIMESTAMP(3),
  "reviewedAt"           TIMESTAMP(3),
  "approvedAt"           TIMESTAMP(3),
  "signatureId"          TEXT,
  "rejectedAt"           TIMESTAMP(3),
  "rejectionNote"        TEXT,

  "assignedBy"           TEXT NOT NULL,
  "assignedAt"           TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "removedAt"            TIMESTAMP(3),

  CONSTRAINT "document_raci_document_fk"
    FOREIGN KEY ("documentId") REFERENCES "documents"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "document_raci_signature_fk"
    FOREIGN KEY ("signatureId") REFERENCES "signature_records"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT "document_raci_letter_check"
    CHECK ("letter" IN ('R', 'A', 'C', 'I')),
  -- "signature required ⇒ cannot be marked done without a signature_id"
  -- Allowed states:
  --   signature_required = false — any completion flag may be set with signatureId NULL
  --   signature_required = true  — if any of submitted/reviewed/approved is set,
  --                                signatureId must also be set
  CONSTRAINT "document_raci_signature_consistency"
    CHECK (
      "signatureRequired" = FALSE
      OR "signatureId" IS NOT NULL
      OR ("submittedAt" IS NULL AND "reviewedAt" IS NULL AND "approvedAt" IS NULL)
    )
);

CREATE UNIQUE INDEX "document_raci_doc_user_letter_section_unique"
  ON "document_raci" ("documentId", "userId", "letter", "sectionId");
CREATE INDEX "document_raci_document_idx" ON "document_raci" ("documentId");
CREATE INDEX "document_raci_user_idx"     ON "document_raci" ("userId");
CREATE INDEX "document_raci_signature_idx" ON "document_raci" ("signatureId");

-- ---------------------------------------------------------------------------
-- guest_invitations: time-boxed signed-URL access for external parties.
--
-- scope='document' → KOL / SME on one doc (read + comment)
-- scope='project'  → external auditor on all docs in one project
--                    (read-only + audit export)
-- CHECK enforces XOR between document_id and project_id matching scope.
-- ---------------------------------------------------------------------------
CREATE TABLE "guest_invitations" (
  "id"            TEXT PRIMARY KEY,
  "scope"         TEXT NOT NULL,
  "documentId"    TEXT,
  "projectId"     TEXT,
  "email"         TEXT NOT NULL,
  "purpose"       TEXT NOT NULL,
  "invitedBy"     TEXT NOT NULL,
  "invitedAt"     TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expiresAt"     TIMESTAMP(3) NOT NULL,
  "revokedAt"     TIMESTAMP(3),
  "jwtText"       TEXT NOT NULL,
  CONSTRAINT "guest_invitations_scope_check"
    CHECK ("scope" IN ('document', 'project')),
  CONSTRAINT "guest_invitations_scope_xor"
    CHECK (
      ("scope" = 'document' AND "documentId" IS NOT NULL AND "projectId" IS NULL)
      OR
      ("scope" = 'project'  AND "projectId"  IS NOT NULL AND "documentId" IS NULL)
    )
);

CREATE INDEX "guest_invitations_document_idx" ON "guest_invitations" ("documentId");
CREATE INDEX "guest_invitations_project_idx"  ON "guest_invitations" ("projectId");
CREATE INDEX "guest_invitations_email_idx"    ON "guest_invitations" ("email");
CREATE INDEX "guest_invitations_expires_idx"  ON "guest_invitations" ("expiresAt");
