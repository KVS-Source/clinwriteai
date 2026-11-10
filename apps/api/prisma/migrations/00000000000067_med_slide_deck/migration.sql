-- Module C slide-deck authoring tables.
--
-- MedSlideDeckJob + MedSlide + MedSlideFigure mirror Module B's SlideDeckJob
-- / Slide / SlideFigure (scoped to Publication) but attach to MedContentItem
-- instead, so Module C can run its own AI slide generation. Pipeline mirrors
-- clinical.ai_initial_draft: deck pins policyVersionAtCreate from
-- DocumentTypePolicy; the worker med_content.ai_slide_draft produces slides
-- against that version so later policy bumps don't rewrite existing decks.

CREATE TABLE "med_slide_deck_jobs" (
  "id"                     TEXT PRIMARY KEY,
  "contentItemId"          TEXT NOT NULL,
  "source"                 TEXT NOT NULL DEFAULT 'full-briefing',
  "congressTarget"         TEXT,
  "slideCountLimit"        INTEGER NOT NULL DEFAULT 25,
  "status"                 TEXT NOT NULL DEFAULT 'draft',
  "aiModel"                TEXT,
  "aiFootprintPct"         INTEGER,
  "policyVersionAtCreate"  INTEGER,
  "generatedAt"            TIMESTAMP(3),
  "createdBy"              TEXT NOT NULL,
  "createdAt"              TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"              TIMESTAMP(3) NOT NULL
);
CREATE INDEX "med_slide_deck_jobs_contentItemId_idx" ON "med_slide_deck_jobs"("contentItemId");
CREATE INDEX "med_slide_deck_jobs_status_idx"        ON "med_slide_deck_jobs"("status");

CREATE TABLE "med_slides" (
  "id"             TEXT PRIMARY KEY,
  "deckJobId"      TEXT NOT NULL,
  "position"       INTEGER NOT NULL,
  "title"          TEXT NOT NULL,
  "bodyHtml"       TEXT NOT NULL,
  "speakerNotes"   TEXT NOT NULL,
  "aiGenerated"    BOOLEAN NOT NULL DEFAULT false,
  "aiModel"        TEXT,
  "aiGeneratedAt"  TIMESTAMP(3),
  "aiPrompt"       TEXT,
  "lastEditedBy"   TEXT,
  "lastEditedAt"   TIMESTAMP(3),
  "createdAt"      TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"      TIMESTAMP(3) NOT NULL,
  CONSTRAINT "med_slides_deckJobId_fkey" FOREIGN KEY ("deckJobId") REFERENCES "med_slide_deck_jobs"("id") ON DELETE CASCADE
);
CREATE INDEX        "med_slides_deckJobId_idx"               ON "med_slides"("deckJobId");
CREATE UNIQUE INDEX "med_slides_deckJobId_position_key"      ON "med_slides"("deckJobId", "position");

CREATE TABLE "med_slide_figures" (
  "id"                TEXT PRIMARY KEY,
  "slideId"           TEXT NOT NULL,
  "figureRef"         TEXT NOT NULL,
  "altText"           TEXT NOT NULL,
  "figureDescription" TEXT NOT NULL,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "med_slide_figures_slideId_fkey" FOREIGN KEY ("slideId") REFERENCES "med_slides"("id") ON DELETE CASCADE
);
CREATE INDEX "med_slide_figures_slideId_idx" ON "med_slide_figures"("slideId");
