-- Per-slide AI confidence + flag array on MedSlide, parity with the
-- MedContentSection rubric. Enables the slide-level ai-suggest route
-- (Package C-7) to persist validator outcomes the same way the
-- section route does, and lets the MedContentAiDebugPanel (Package D-5)
-- render a per-slide confidence badge in HCP deck editors.
--
-- Both columns are nullable + default-safe so legacy MedSlide rows
-- stay valid; the ai-suggest wrapper populates them on the next
-- rewrite. Rollback = DROP COLUMN on both.

ALTER TABLE "med_slides"
  ADD COLUMN "ai_confidence" INTEGER,
  ADD COLUMN "ai_flags"      TEXT[] NOT NULL DEFAULT '{}';
