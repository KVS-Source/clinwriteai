-- Author's prompt to the AI drafter (2026-11-02).
--
-- Captured in the New Document wizard when "Draft with AI" is opted
-- into. Flows into the system prompt of every AI call for this
-- document (initial draft, validation re-drafts, future per-section
-- regenerate). Lets the creator steer language ("draft in Japanese"),
-- tone ("plain English, no jargon"), structure ("include tables where
-- helpful"), or house style ("follow MHRA house style").
--
-- Capped at 2000 chars in the Zod schema at the edge; the DB column is
-- plain TEXT so an admin bypass or future wider cap doesn't need a
-- migration. Null = no instructions were given (worker uses the default
-- system prompt).

ALTER TABLE "documents"
  ADD COLUMN "ai_instructions" TEXT;
