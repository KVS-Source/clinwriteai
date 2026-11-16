-- Module scope of a regulatory framework: which ClinWrite modules it applies to (A Clinical, B Scientific,
-- C Medical, D Regulatory Writing, E Ideation & Publishing). Shown as scope dots in the ICH Frameworks registry.
ALTER TABLE "regulatory_frameworks" ADD COLUMN "scope" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Default for the ICH guidelines already synced from ich.org: Efficacy and Multidisciplinary guidelines apply to
-- every module; Quality and Safety (CMC and non-clinical) to Regulatory Writing.
UPDATE "regulatory_frameworks" SET "scope" = ARRAY['A','B','C','D','E']
  WHERE "jurisdiction" = 'ICH' AND "category" IN ('efficacy', 'multidisciplinary');
UPDATE "regulatory_frameworks" SET "scope" = ARRAY['D']
  WHERE "jurisdiction" = 'ICH' AND "category" IN ('quality', 'safety');
