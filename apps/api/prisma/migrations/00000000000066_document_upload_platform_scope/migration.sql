-- Relax DocumentUpload.projectId to allow platform-level uploads.
--
-- The DocumentTypePolicy best-practice distiller feeds on a DocumentUpload
-- row (so the pipeline stays uniform with every other PDF we hand to
-- Claude). Best-Practice PDFs are platform assets, not scoped to a
-- project, so projectId is now nullable. A null projectId + sourceCategory
-- in ('best_practice', ...) is the "platform asset" signal.
ALTER TABLE "document_uploads" ALTER COLUMN "project_id" DROP NOT NULL;
