-- Slide deck backend (sPM-slide-deck-backend).
--
-- First real backing for the Module B SlidedeckGenerator UI (which until
-- now spoke to non-existent endpoints). Three tables: slide_deck_jobs
-- (per publication, per generation run), slides (one row per slide), and
-- slide_figures (one row per inline figure with alt text).
--
-- Content fields (title / body / notes) are plain TEXT; the UI stores them
-- as plain prose, no HTML required. Edit history uses the polymorphic
-- EditHistory table with entityType='slide' + entityId=slide.id + a JSON
-- payload serialising all three fields in before/after.

CREATE TABLE "slide_deck_jobs" (
  "id"                TEXT         NOT NULL,
  "publicationId"     TEXT         NOT NULL,
  "source"            TEXT         NOT NULL DEFAULT 'full-manuscript',
  "congressTarget"    TEXT,
  "slideCountLimit"   INTEGER      NOT NULL DEFAULT 20,
  "status"            TEXT         NOT NULL DEFAULT 'draft',          -- draft|generating|ready|exported
  "aiModel"           TEXT         NOT NULL DEFAULT 'claude-sonnet-4-6',
  "aiFootprintPct"    INTEGER      NOT NULL DEFAULT 0,
  "generatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "createdAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "slide_deck_jobs_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "slide_deck_jobs_publicationId_fkey" FOREIGN KEY ("publicationId")
    REFERENCES "publications"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "slide_deck_jobs_publicationId_idx" ON "slide_deck_jobs" ("publicationId");

CREATE TABLE "slides" (
  "id"              TEXT         NOT NULL,
  "slideDeckJobId"  TEXT         NOT NULL,
  "position"        INTEGER      NOT NULL,
  "title"           TEXT         NOT NULL DEFAULT '',
  "bodyText"        TEXT         NOT NULL DEFAULT '',
  "speakerNotes"    TEXT         NOT NULL DEFAULT '',
  "createdAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt"       TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "slides_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "slides_slideDeckJobId_fkey" FOREIGN KEY ("slideDeckJobId")
    REFERENCES "slide_deck_jobs"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "slides_slideDeckJobId_position_idx" ON "slides" ("slideDeckJobId", "position");

CREATE TABLE "slide_figures" (
  "id"                TEXT NOT NULL,
  "slideId"           TEXT NOT NULL,
  "figureRef"         TEXT NOT NULL,
  "altText"           TEXT,
  "figureDescription" TEXT,

  CONSTRAINT "slide_figures_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "slide_figures_slideId_fkey" FOREIGN KEY ("slideId")
    REFERENCES "slides"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "slide_figures_slideId_idx" ON "slide_figures" ("slideId");
