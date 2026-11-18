-- SectionTemplate — per-section formatting JSON that flows into every
-- AI call so Claude preserves the styling (font, paragraph, list, table,
-- references, page) authored for that section.
--
-- Mirrors the AiPromptRecord / BestPracticeRecord pointer pattern
-- (migrations 73 + 74): versioned per (docType, sectionKey) with a
-- draft → approved → retired lifecycle. Documents snapshot both the
-- pointer and the JSON onto each section row at create time so later
-- admin approvals don't retroactively rewrite formatting of sections
-- already in flight.

CREATE TABLE "section_templates" (
  "id"             TEXT        PRIMARY KEY,
  "docType"        TEXT        NOT NULL,                 -- 'protocol' | 'csr_full' | 'manuscript' | …
  "sectionKey"     TEXT        NOT NULL,                 -- e.g. 's6_2', 'methods'
  "version"        INTEGER     NOT NULL,                 -- 1-based, unique per (docType, sectionKey)
  "status"         TEXT        NOT NULL DEFAULT 'draft', -- 'draft' | 'approved' | 'retired'

  -- Full-fidelity format JSON. Validated by the Zod SectionTemplateFormat
  -- schema in apps/api/src/modules/platform/section-template/schema.ts.
  -- Top-level keys today: page, font, paragraph, heading, list, table,
  -- references, numbering. Shaped to extend toward OOXML parity (headers,
  -- footers, content controls) without breaking existing rows.
  "formatJson"     JSONB       NOT NULL DEFAULT '{}',

  -- Lifecycle breadcrumbs — same shape as ai_prompt_records.
  "supersededBy"   TEXT,
  "effectiveDate"  TIMESTAMP(3),
  "retiredAt"      TIMESTAMP(3),
  "retireReason"   TEXT,
  "approvedBy"     TEXT,
  "approvedAt"     TIMESTAMP(3),

  "createdBy"      TEXT        NOT NULL,
  "updatedBy"      TEXT        NOT NULL,
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL
);

CREATE UNIQUE INDEX "section_templates_docType_sectionKey_version_key"
  ON "section_templates"("docType", "sectionKey", "version");
CREATE INDEX "section_templates_docType_sectionKey_status_idx"
  ON "section_templates"("docType", "sectionKey", "status");
CREATE INDEX "section_templates_status_idx"
  ON "section_templates"("status");

-- --- Section pin columns (nullable; filled on new section creation) ----
-- Two columns per section table:
--   section_template_record_id → pointer to the pinned SectionTemplate row
--   template_format_json       → snapshot of formatJson at create time
-- The snapshot is what the AI resolver prefers to read so authored
-- sections never drift when admin approves a newer SectionTemplate.
-- The pointer stays for audit + "which template version was this?"
-- preview on the debug panel.

-- Clinical (Module A)
ALTER TABLE "section_contents"
  ADD COLUMN "section_template_record_id" TEXT,
  ADD COLUMN "template_format_json"       JSONB;
CREATE INDEX "section_contents_section_template_record_id_idx"
  ON "section_contents"("section_template_record_id");

-- Publications (Module B)
ALTER TABLE "publication_section_contents"
  ADD COLUMN "section_template_record_id" TEXT,
  ADD COLUMN "template_format_json"       JSONB;
CREATE INDEX "publication_section_contents_section_template_record_id_idx"
  ON "publication_section_contents"("section_template_record_id");

-- Medical content (Module C)
ALTER TABLE "med_content_sections"
  ADD COLUMN "section_template_record_id" TEXT,
  ADD COLUMN "template_format_json"       JSONB;
CREATE INDEX "med_content_sections_section_template_record_id_idx"
  ON "med_content_sections"("section_template_record_id");

-- Regulatory (Module D)
ALTER TABLE "regulatory_document_sections"
  ADD COLUMN "section_template_record_id" TEXT,
  ADD COLUMN "template_format_json"       JSONB;
CREATE INDEX "regulatory_document_sections_section_template_record_id_idx"
  ON "regulatory_document_sections"("section_template_record_id");

-- Ideation (Module E)
ALTER TABLE "ideation_artefact_sections"
  ADD COLUMN "section_template_record_id" TEXT,
  ADD COLUMN "template_format_json"       JSONB;
CREATE INDEX "ideation_artefact_sections_section_template_record_id_idx"
  ON "ideation_artefact_sections"("section_template_record_id");
