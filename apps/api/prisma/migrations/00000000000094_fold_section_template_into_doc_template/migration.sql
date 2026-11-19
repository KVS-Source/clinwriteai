-- Fold SectionTemplate into DocumentTemplate.
--
-- Rationale: a separate per-(docType, sectionKey) entity + its own admin
-- tab was a layer too far. The template is already the authoritative
-- source for what a document's sections look like; it should also carry
-- the per-section formatting rules AI follows at draft/rewrite time.
--
-- After this migration:
--   - DocumentTemplate.sections[] (JSON) carries formatRules per section
--     — populated by the extended distill-template worker on PDF upload.
--   - SectionContent.templateFormatRules stays as the per-document
--     snapshot (filled at document create from the template's section).
--   - The sectionTemplateRecordId pin column is obsolete (there's no row
--     to point at any more) and dropped here.
--
-- Not reversible without re-running the distiller to regenerate the
-- per-section formatRules, but no production data is at risk — the
-- SectionTemplate rows were only populated by the distiller itself and
-- hadn't been edited by hand on any install.

DROP TABLE IF EXISTS "section_templates";

-- Section-level pin pointer no longer has a target. The TEXT snapshot
-- column (template_format_rules) survives — it's still the snapshot the
-- resolver prefers; just sourced from DocumentTemplate.sections now.
ALTER TABLE "section_contents"               DROP COLUMN IF EXISTS "section_template_record_id";
ALTER TABLE "publication_section_contents"   DROP COLUMN IF EXISTS "section_template_record_id";
ALTER TABLE "med_content_sections"           DROP COLUMN IF EXISTS "section_template_record_id";
ALTER TABLE "regulatory_document_sections"   DROP COLUMN IF EXISTS "section_template_record_id";
ALTER TABLE "ideation_artefact_sections"     DROP COLUMN IF EXISTS "section_template_record_id";
