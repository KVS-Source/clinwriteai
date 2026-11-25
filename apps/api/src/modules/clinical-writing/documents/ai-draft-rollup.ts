// Section counts and elapsed time for the AI Debug build summary, over all worker runs of a document.
// A restarted or resumed draft logs the same sections again, so the steps can't simply be counted.

export interface RollupStep {
  kind:      string
  sectionId: string | null
  timestamp: Date
}

/** Steps the draft/validation worker writes (not TBD auto-fill or a section rewrite, which can come days later). */
const WORKER_STEP = /^(job_|source_|policy_loaded$|prompt_assembled$|section_|validation_pass_)/

/** Steps oldest first. Each section counts once: drafted if any run wrote it, else by its latest outcome. */
export function draftRollup(steps: ReadonlyArray<RollupStep>): {
  sectionsDrafted: number
  sectionsErrored: number
  sectionsSkipped: number
  runs:            number
  startedAt:       Date | null
  elapsedMs:       number | null
} {
  const outcome = new Map<string, 'drafted' | 'errored' | 'skipped'>()
  let runs = 0
  let startedAt: Date | null = null
  let endedAt: Date | null = null
  for (const [i, s] of steps.entries()) {
    if (s.kind === 'job_started') {
      runs += 1
      startedAt ??= s.timestamp
    }
    if (WORKER_STEP.test(s.kind)) endedAt = s.timestamp
    const id = s.sectionId ?? `step-${i}`
    if (s.kind === 'section_committed') outcome.set(id, 'drafted')
    else if (outcome.get(id) === 'drafted') continue
    else if (s.kind === 'section_errored') outcome.set(id, 'errored')
    else if (s.kind === 'section_skipped') outcome.set(id, 'skipped')
  }
  const count = (o: string) => [...outcome.values()].filter(v => v === o).length
  return {
    sectionsDrafted: count('drafted'),
    sectionsErrored: count('errored'),
    sectionsSkipped: count('skipped'),
    runs,
    startedAt,
    elapsedMs: startedAt && endedAt ? Math.max(0, endedAt.getTime() - startedAt.getTime()) : null,
  }
}
