-- Phase 1 of the checklist overhaul.
--
-- Adds ownership + stage tagging to the checklist tables so the Phase 2
-- gates (submit-for-review / stage-advance / signature) can filter items
-- by stage, and so items can roll up to a RACI role instead of being
-- globally tickable by any team member.
--
-- Also introduces the draft→locked lifecycle on ChecklistTemplate: a
-- project-level override starts 'draft' while an Admin customises it and
-- flips to 'locked' on approval. The code-shipped platform baseline is
-- always 'locked' (hence the DEFAULT).
--
-- Backwards-safe defaults so existing rows don't need a backfill at
-- migration time: ownerRaci='R', stage='study_start_up', templateStatus
-- ='locked'. The seed + backfill scripts then overwrite stage/ownerRaci
-- on real items.

-- ===== checklist_templates =====

ALTER TABLE "checklist_templates"
  ADD COLUMN "projectId"       TEXT,
  ADD COLUMN "templateStatus"  TEXT NOT NULL DEFAULT 'locked',
  ADD COLUMN "approvedBy"      TEXT,
  ADD COLUMN "approvedAt"      TIMESTAMP(3);

-- Replace the (deliverableType, version) uniqueness with the wider
-- (deliverableType, projectId, version). Null projectId is treated as a
-- distinct value by Postgres unique indexes by default, which is what
-- we want: one baseline + N project overrides per deliverable type.
ALTER TABLE "checklist_templates"
  DROP CONSTRAINT IF EXISTS "checklist_templates_deliverableType_version_key";
ALTER TABLE "checklist_templates"
  ADD CONSTRAINT "checklist_templates_deliverableType_projectId_version_key"
  UNIQUE ("deliverableType", "projectId", "version");

CREATE INDEX "checklist_templates_projectId_idx"
  ON "checklist_templates" ("projectId");

-- ===== checklist_template_items =====

ALTER TABLE "checklist_template_items"
  ADD COLUMN "ownerRaci"       TEXT NOT NULL DEFAULT 'R',
  ADD COLUMN "stage"           TEXT NOT NULL DEFAULT 'study_start_up',
  ADD COLUMN "autoCompleteOn"  TEXT;

-- ===== checklist_instance_items =====
-- Snapshotted at clone time so a template bump never retro-mutates an
-- in-flight document (PRD rule).

ALTER TABLE "checklist_instance_items"
  ADD COLUMN "ownerRaci"       TEXT NOT NULL DEFAULT 'R',
  ADD COLUMN "stage"           TEXT NOT NULL DEFAULT 'study_start_up',
  ADD COLUMN "autoCompleteOn"  TEXT;
