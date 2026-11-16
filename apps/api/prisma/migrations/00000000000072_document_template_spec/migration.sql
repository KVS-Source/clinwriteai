-- A template can now carry more than its section list: page layout, styles, header / footer, table style,
-- placeholder rules, writing standards, front / back matter and provenance (the ICH M11 protocol
-- template is the first). Stored beside the existing sections JSON; NULL for templates that only
-- carry a section list, so existing rows are unchanged.
ALTER TABLE "document_templates" ADD COLUMN "spec" JSONB;
