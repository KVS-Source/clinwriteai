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
 * The current worker output limit for drafting + validation
 * (MAX_SECTION_OUTPUT_TOKENS, MAX_CRITIQUE_OUTPUT_TOKENS): 8000. The 2000
 * entry was retired on 2026-11-27 because no active code path caps at
 * 2000 anymore, and the heuristic was firing false positives on natural
 * stops that happened to land at exactly 2000 output tokens (an 8,412-
 * char section at ~4.2 chars/token is a plausible end_turn response).
 *
 * The steps still don't record the actual max_tokens requested or
 * Claude's stop_reason, so this remains a heuristic — it flags any
 * answer that lands on exactly 8000 output tokens regardless of why.
 * If the output cap changes again, update this Set.
 */
const OUTPUT_LIMITS: ReadonlySet<unknown> = new Set([8000])

const hitLimit = (s: DebugStepLike) => OUTPUT_LIMITS.has(s.details?.outputTokens)

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

// ---------------------------------------------------------------- the "Finished by code" step

/** The report the worker's finishing pass stores on its step (details.finishing; worker finishing.ts FinishReport). */
interface FinishingReport {
  crossReferences?: { resolved?: number; broken?: Array<{ section: string; target: string }> }
  references?:      { cited?: number; listed?: number; notFound?: Array<{ section: string; citation: string }> }
  abbreviations?:   { defined?: number; undefined?: Array<{ acronym: string; sections: string[] }>; fromGlossary?: string[] }
  mismatches?:      Array<{ section: string; fact: string; expected: string; found: string }>
}

export interface FinishingItem { sections: string[]; text: string; count: number }
export interface FinishingGroup { key: 'cross-references' | 'references' | 'abbreviations' | 'facts'; label: string; items: FinishingItem[] }

export function finishingReportOf(s: DebugStepLike): FinishingReport | null {
  const r = s.details?.finishing
  return r && typeof r === 'object' ? r as FinishingReport : null
}

/** The finishing report's items to check, grouped, with repeats in a section counted once ("15×"). */
export function finishingGroups(r: FinishingReport): FinishingGroup[] {
  const tally = (rows: Array<{ section: string; text: string }>): FinishingItem[] => {
    const by = new Map<string, FinishingItem>()
    for (const row of rows) {
      const key = `${row.section}\u0000${row.text}`
      const hit = by.get(key)
      if (hit) hit.count += 1
      else by.set(key, { sections: [row.section], text: row.text, count: 1 })
    }
    return [...by.values()]
  }
  const groups: FinishingGroup[] = [
    { key: 'cross-references', label: 'Broken cross-references', items: tally((r.crossReferences?.broken ?? []).map(b => ({
      section: b.section, text: `Points to ${b.target}, which is not a section or heading of this document.`,
    }))) },
    { key: 'references', label: 'References not found', items: tally((r.references?.notFound ?? []).map(n => ({
      section: n.section,
      // [REF: source | N] the code would not list: a sample protocol (example only) or a source it could not read.
      text: n.citation.trim().toLowerCase() === 'source'
        ? 'Cites an attached source that cannot be listed: a sample protocol (example only) or a file that could not be read.'
        : `“${n.citation}” is not in the evidence sources.`,
    }))) },
    { key: 'abbreviations', label: 'Undefined abbreviations', items: (r.abbreviations?.undefined ?? []).map(u => ({
      sections: u.sections, text: `${u.acronym} is never spelled out.`, count: 1,
    })) },
    { key: 'facts', label: 'Different from the fact sheet', items: tally((r.mismatches ?? []).map(m => ({
      section: m.section, text: `${m.fact}: “${m.found}”, the fact sheet says “${m.expected}”.`,
    }))) },
  ]
  return groups.filter(g => g.items.length > 0)
}

/** Section ids the drafter wrote again after this step, so what the step says about them may be out of date. */
export function rewrittenAfter(step: DebugStepLike, steps: ReadonlyArray<DebugStepLike>): Set<string> {
  const at = Date.parse(step.timestamp)
  return new Set(steps.filter(s => s.kind === 'section_committed' && s.sectionId && Date.parse(s.timestamp) > at).map(s => s.sectionId!))
}

/** Sections the build plan never gives to the AI: main headings, and sections code builds afterwards. */
const isByDesignSkip = (s: DebugStepLike) =>
  s.kind === 'section_skipped' && (s.details?.reason === 'main_heading' || s.details?.reason === 'built_by_code')

/**
 * The steps with each unbroken run of by-design skips folded into one entry, so a log shows one row per drafting run
 * instead of a dozen that read like failures. Every other step, including a section kept because it had text, is unchanged.
 */
export function groupByDesignSkips<S extends DebugStepLike>(steps: ReadonlyArray<S>): Array<S | { notDrafted: S[] }> {
  const out: Array<S | { notDrafted: S[] }> = []
  let group: S[] | null = null
  for (const s of steps) {
    if (!isByDesignSkip(s)) {
      group = null
      out.push(s)
    } else if (group) {
      group.push(s)
    } else {
      group = [s]
      out.push({ notDrafted: group })
    }
  }
  return out
}

/** The folded row's sentence, e.g. "11 main headings (content is in their sub-sections) and References (built by code)." */
export function notDraftedSummary(
  skips:    ReadonlyArray<DebugStepLike>,
  sections: ReadonlyArray<{ sectionId: string; sectionTitle?: string | null }>,
): string {
  const headings = skips.filter(s => s.details?.reason === 'main_heading').length
  const titleOf = new Map(sections.map(s => [s.sectionId, s.sectionTitle]))
  const byCode = skips.filter(s => s.details?.reason === 'built_by_code').map(s => titleOf.get(s.sectionId ?? '') || 'a section')
  const parts: string[] = []
  if (headings > 0) {
    parts.push(headings === 1 ? '1 main heading (content is in its sub-sections)' : `${headings} main headings (content is in their sub-sections)`)
  }
  if (byCode.length > 0) parts.push(`${byCode.join(', ')} (built by code)`)
  return `${parts.join(' and ')}.`
}
