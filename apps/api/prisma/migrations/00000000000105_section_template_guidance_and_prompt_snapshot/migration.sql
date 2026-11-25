-- Per-section snapshot of template guidance + AI prompt rules + must-preserve manifest.
--
-- Three gaps today in the AI rewrite-section path (POST /ai-suggest):
--
--   1. The template parser (distill-template worker) extracts formatRules
--      per section but never populates the `instructions` / `guidance`
--      fields the schema already declares on DocumentTemplate.sections.
--      Content guidance ("what this section must cover") is lost at upload
--      and never reaches the AI prompt. This migration adds two per-section
--      snapshot columns the create service can populate once the parser
--      is extended (Package 2 of the plan).
--
--   2. AiPromptRecord.sectionRules is looked up live from the record
--      pinned on the document at every regenerate call. If an admin edits
--      the pinned row in place (no new version), in-flight documents
--      silently pick up the change — Part 11 audit gap. Snapshotting the
--      per-section slice onto the SectionContent row at create time
--      closes it and mirrors the pattern already used for
--      templateFormatRules.
--
--   3. Cross-reference markers, numeric values, study IDs and acronym
--      definitions in the current section body need to survive a rewrite.
--      Caching the extracted manifest per section (rebuilt on body save)
--      lets the retry wrapper diff before/after without re-extracting
--      from the pre-call HTML on every call.
--
-- All columns are nullable so this migration is non-blocking against
-- live tables; the backfill script (Package 10) fills them for in-flight
-- documents. Rollback = DROP COLUMN on each table — no data loss.

-- Module A — section_contents (SectionContent)
ALTER TABLE "section_contents"
  ADD COLUMN "template_instructions"    TEXT,
  ADD COLUMN "template_guidance"        TEXT,
  ADD COLUMN "ai_prompt_section_rules"  JSONB,
  ADD COLUMN "must_preserve_manifest"   JSONB;

-- Module B — publication_section_contents (PublicationSectionContent)
ALTER TABLE "publication_section_contents"
  ADD COLUMN "template_instructions"    TEXT,
  ADD COLUMN "template_guidance"        TEXT,
  ADD COLUMN "ai_prompt_section_rules"  JSONB,
  ADD COLUMN "must_preserve_manifest"   JSONB;

-- Module C — med_content_sections (MedContentSection)
ALTER TABLE "med_content_sections"
  ADD COLUMN "template_instructions"    TEXT,
  ADD COLUMN "template_guidance"        TEXT,
  ADD COLUMN "ai_prompt_section_rules"  JSONB,
  ADD COLUMN "must_preserve_manifest"   JSONB;

-- Module D — regulatory_document_sections (RegulatoryDocumentSection)
ALTER TABLE "regulatory_document_sections"
  ADD COLUMN "template_instructions"    TEXT,
  ADD COLUMN "template_guidance"        TEXT,
  ADD COLUMN "ai_prompt_section_rules"  JSONB,
  ADD COLUMN "must_preserve_manifest"   JSONB;

-- Module E — ideation_artefact_sections (IdeationArtefactSection)
ALTER TABLE "ideation_artefact_sections"
  ADD COLUMN "template_instructions"    TEXT,
  ADD COLUMN "template_guidance"        TEXT,
  ADD COLUMN "ai_prompt_section_rules"  JSONB,
  ADD COLUMN "must_preserve_manifest"   JSONB;
