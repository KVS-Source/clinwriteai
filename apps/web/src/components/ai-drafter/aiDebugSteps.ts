// Readings of the AI Debug worker steps: what a skip really means, and which answers ran out of room.

export interface DebugStepLike {
  id:         string
  kind:       string
  message:    string
  sectionId:  string | null
  details?:   Record<string, unknown>
  timestamp:  string
}

/**
 * The output limit of both worker calls (MAX_SECTION_OUTPUT_TOKENS, MAX_CRITIQUE_OUTPUT_TOKENS). The steps don't record
 * it, so only an answer of exactly this length counts: if the limit changes, nothing is wrongly marked.
 */
const OUTPUT_LIMIT = 2000

const hitLimit = (s: DebugStepLike) => s.details?.outputTokens === OUTPUT_LIMIT

/** True for a drafted answer that stopped at the output limit. */
export function isAtLimit(s: DebugStepLike): boolean {
  return s.kind === 'section_response' && hitLimit(s)
}

/** Sections whose latest answer stopped at the output limit. */
export function sectionsAtLimit(steps: ReadonlyArray<DebugStepLike>): number {
  const latest = new Map<string, boolean>()
  for (const s of steps) if (s.kind === 'section_response') latest.set(s.sectionId ?? s.id, hitLimit(s))
  return [...latest.values()].filter(Boolean).length
}

/** The latest validation answer filled its limit yet gave no flags: the list was probably cut off and could not be read. */
export function validationCutOff(steps: ReadonlyArray<DebugStepLike>): boolean {
  const last = [...steps].reverse().find(s => s.kind === 'section_ai_call')
  return !!last && hitLimit(last) && last.details?.sectionsFlagged === 0
}

/**
 * Step id → wording for sections left alone because they already had text. The worker says "writer already filled it in"
 * for all of them, whoever wrote it.
 */
export function keptSectionNotes(
  steps:    ReadonlyArray<DebugStepLike>,
  sections: ReadonlyArray<{ sectionId: string; lastEditedAt?: string | null }>,
): Map<string, string> {
  const lastEdited = new Map(sections.map(s => [s.sectionId, s.lastEditedAt ?? null]))
  const aiWrote = new Set<string>()
  const notes = new Map<string, string>()
  for (const s of steps) {
    if (!s.sectionId) continue
    if (s.kind === 'section_committed') aiWrote.add(s.sectionId)
    if (s.kind !== 'section_skipped' || s.details?.reason !== 'writer_edit') continue
    const name = /^Skipped (.+) — writer already filled it in\.$/.exec(s.message)?.[1] ?? 'Section'
    const why = aiWrote.has(s.sectionId)
      ? 'already drafted by AI in an earlier run'
      : lastEdited.has(s.sectionId) && lastEdited.get(s.sectionId) === null
        ? 'template text kept'
        : 'kept, it already had text'
    notes.set(s.id, `${name} — ${why}.`)
  }
  return notes
}
