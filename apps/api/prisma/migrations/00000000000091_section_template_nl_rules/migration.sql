-- SectionTemplate — JSON → Natural-language flip.
--
-- Migration 90 shipped SectionTemplate.formatJson as a structured Zod
-- schema (page/font/paragraph/table/…) that the API renderer translated
-- into natural-language rules on every AI call. Product decision 2026-11-18:
-- flip the storage shape itself to NL — admins author in prose, AI reads
-- verbatim, no schema to maintain, no renderer parity to guard. Trade-off:
-- no programmatic .docx round-trip from the stored template (would need
-- a parallel structured theme if that becomes a requirement).
--
-- Destructive because migration 90 shipped hours ago with no data in
-- the JSON columns. No backfill step.

-- Section Templates: replace formatJson (JSONB) with formatRules (TEXT).
ALTER TABLE "section_templates" DROP COLUMN "formatJson";
ALTER TABLE "section_templates" ADD COLUMN "formatRules" TEXT NOT NULL DEFAULT '';

-- Per-section pins: replace template_format_json (JSONB) with
-- template_format_rules (TEXT). Same shape on all 5 section tables.

ALTER TABLE "section_contents"
  DROP COLUMN "template_format_json",
  ADD  COLUMN "template_format_rules" TEXT;

ALTER TABLE "publication_section_contents"
  DROP COLUMN "template_format_json",
  ADD  COLUMN "template_format_rules" TEXT;

ALTER TABLE "med_content_sections"
  DROP COLUMN "template_format_json",
  ADD  COLUMN "template_format_rules" TEXT;

ALTER TABLE "regulatory_document_sections"
  DROP COLUMN "template_format_json",
  ADD  COLUMN "template_format_rules" TEXT;

ALTER TABLE "ideation_artefact_sections"
  DROP COLUMN "template_format_json",
  ADD  COLUMN "template_format_rules" TEXT;
