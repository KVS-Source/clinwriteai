-- AiPromptRecord gains crossCuttingRules so the resolver can replace the
-- verbatim SME prompt dump with a compact "GENERAL RULES" block on
-- every AI call.
--
-- Today every section call injects the entire smePrompt text — a 7.5k
-- char SME prompt × 62 sections ≈ 118k tokens of scaffolding per
-- initial draft. After this migration + the associated extractor
-- change, the SME prompt is parsed ONCE at admin time into:
--   - crossCuttingRules  — rules that apply to every section
--   - sectionRules       — per-section rules (already existed)
-- At AI-call time the resolver emits the cross-cutting list + the
-- per-section slice; the raw smePrompt stays in the row as the source
-- of truth for re-extraction + audit but stops flowing to Claude.
--
-- Shape of the JSON (same as sectionRules entries for consistency):
--   [{ "severity": "must" | "should" | "nice", "text": "..." }]
--
-- Nullable + defaulted to `[]` so the resolver can handle rows that
-- haven't been re-extracted yet — it just falls back to the old
-- "SME PROMPT verbatim" path until the admin re-runs the extractor.

ALTER TABLE "ai_prompt_records"
  ADD COLUMN "crossCuttingRules" JSONB NOT NULL DEFAULT '[]';
