// Canonical ICH E3 §1–§16 mandatory section catalog (FR-A-026).
//
// 18 sections — the top 15 are always required; §16.1–§16.3 round out the
// appendix. §16.4 (US-only Individual Patient Data Listings) is conditional
// on US submission: it's listed only when the document has an §16.4 section
// or a waiver for it, and never counts toward the 18 mandatory sections.
//
// `sectionId` maps each ICH code to the editor's stable section key so the
// "Open in editor →" link in the panel always resolves (previously only §11
// and §12 were wired, via a hard-coded map). The format matches the editor's
// section id scheme: `s{N}` for top-level, `s{N}_{sub}` for nested.

export interface IchSectionDef {
  code:         string         // '§1', '§16.3', …
  sectionId:    string         // 's1', 's16_3', …
  title:        string
  conditional?: boolean        // true → listed only when present, never counted
}

export const ICH_E3_SECTIONS: ReadonlyArray<IchSectionDef> = [
  { code: '§1',    sectionId: 's1',    title: 'Title Page' },
  { code: '§2',    sectionId: 's2',    title: 'Synopsis' },
  { code: '§3',    sectionId: 's3',    title: 'Table of Contents' },
  { code: '§4',    sectionId: 's4',    title: 'List of Abbreviations' },
  { code: '§5',    sectionId: 's5',    title: 'Ethics' },
  { code: '§6',    sectionId: 's6',    title: 'Investigators and Study Administrative Structure' },
  { code: '§7',    sectionId: 's7',    title: 'Introduction' },
  { code: '§8',    sectionId: 's8',    title: 'Study Objectives' },
  { code: '§9',    sectionId: 's9',    title: 'Investigational Plan' },
  { code: '§10',   sectionId: 's10',   title: 'Study Patients' },
  { code: '§11',   sectionId: 's11',   title: 'Efficacy Evaluation' },
  { code: '§12',   sectionId: 's12',   title: 'Safety Evaluation' },
  { code: '§13',   sectionId: 's13',   title: 'Discussion and Overall Conclusions' },
  { code: '§14',   sectionId: 's14',   title: 'Tables, Figures and Graphs' },
  { code: '§15',   sectionId: 's15',   title: 'Reference List' },
  { code: '§16.1', sectionId: 's16_1', title: 'Appendix — Study Information' },
  { code: '§16.2', sectionId: 's16_2', title: 'Appendix — Patient Data Listings' },
  { code: '§16.3', sectionId: 's16_3', title: 'Appendix — Case Report Forms' },
  { code: '§16.4', sectionId: 's16_4', title: 'Appendix — Individual Patient Data Listings (US)', conditional: true },
]

/** Fast lookup by code — used by the waive endpoint to reject bad input. */
export const ICH_E3_SECTION_CODES: ReadonlySet<string> = new Set(ICH_E3_SECTIONS.map(s => s.code))

/** Number of mandatory sections — the denominator for completion. */
export const ICH_E3_MANDATORY_COUNT = ICH_E3_SECTIONS.filter(s => !s.conditional).length

/**
 * ICH E3 governs the full Clinical Study Report only. The DB stores
 * `csr_full`; the API shapes it to `csr-full` — accept both.
 */
export function isIchE3Applicable(documentType: string): boolean {
  return documentType === 'csr_full' || documentType === 'csr-full'
}

/** True when the HTML holds real text (not empty or a lone empty paragraph). */
export function hasSectionContent(contentHtml: string | null | undefined): boolean {
  const html = contentHtml?.trim() ?? ''
  return html !== '' && html !== '<p></p>'
}

/** The section's visible text, tags stripped. */
function sectionText(contentHtml: string | null | undefined): string {
  return (contentHtml ?? '').replace(/<[^>]*>/g, ' ').replace(/&nbsp;/g, ' ').trim()
}

/** Whitespace-separated word count of the section's visible text. */
export function sectionWordCount(contentHtml: string | null | undefined): number {
  const text = sectionText(contentHtml)
  return text === '' ? 0 : text.split(/\s+/).length
}

// Bracketed drafting markers a finished section must not contain: [TBD],
// [TBC], [X] / [XX], [PLACEHOLDER], [REF], [INSERT …] and the AI drafter's
// [STUB_…] text. Case-insensitive.
const PLACEHOLDER_PATTERN = /\[\s*(?:TBD|TBC|X+|PLACEHOLDER|REF|INSERT\b[^\]]*|STUB_[^\]]*)\s*\]/gi

/** Number of placeholder markers left in the section's visible text. */
export function sectionPlaceholderCount(contentHtml: string | null | undefined): number {
  return sectionText(contentHtml).match(PLACEHOLDER_PATTERN)?.length ?? 0
}

/** Below this many words a section gets a "check it's finished" hint. */
export const ICH_MIN_SECTION_WORDS = 20

/** '§11.4' / '11.4' / '§ 11.4' → '11.4', so comment sectionRefs match section numbers. */
export function normalizeSectionRef(ref: string): string {
  return ref.replace(/^(§\s*)+/, '').trim().toLowerCase()
}

// --- Section progress (the status-icon tooltip) ---
//
// Each row also carries a breakdown of how far along the section is: a fixed
// list of checks, scored "n of m done". It's informational only — status and
// the completion percent above don't read it. The checks live in this one
// list so the set can change in one place; a check that returns null doesn't
// apply to the section (e.g. no subsections) and is left out of the total.
//
// The set follows the usual medical-writing "section done" steps: written,
// no drafting placeholders left, all subsections done, review comments
// resolved, author sign-off. Word count is deliberately not scored — short
// sections (title page, ToC) can be complete.

export type IchProgressCheckKey =
  | 'has_content'
  | 'no_placeholders'
  | 'subsections_complete'
  | 'no_open_comments'
  | 'marked_complete'

interface ProgressFacts {
  hasContent:     boolean
  placeholders:   number
  markedComplete: boolean
  subsections?:   { total: number; completed: number }
  openComments:   number
}

export const ICH_PROGRESS_CHECKS: ReadonlyArray<{ key: IchProgressCheckKey; evaluate: (f: ProgressFacts) => boolean | null }> = [
  { key: 'has_content',          evaluate: f => f.hasContent },
  { key: 'no_placeholders',      evaluate: f => f.hasContent ? f.placeholders === 0 : null },
  { key: 'subsections_complete', evaluate: f => f.subsections ? f.subsections.completed === f.subsections.total : null },
  { key: 'no_open_comments',     evaluate: f => f.openComments === 0 },
  { key: 'marked_complete',      evaluate: f => f.markedComplete },
]

export interface IchSectionProgress {
  wordCount:        number
  minWords:         number                                  // the short-section hint threshold (not scored)
  placeholders:     number
  markedComplete:   boolean
  subsections?:     { total: number; completed: number }   // only when the section has subsections
  openComments:     number                                  // open comments needing action (approvals excluded)
  sourceReferences: number                                  // info only, not scored
  lastEditedAt:     string | null                           // ISO
  lastEditedByName: string | null
  checks:           Array<{ key: IchProgressCheckKey; passed: boolean }>
  checksDone:       number
  checksTotal:      number
}

/**
 * Match an ICH catalog section against the Document's SectionContent rows.
 * The DB stores section ids like `s11`, `s16_1`; the catalog expects an
 * exact match, with a fallback to prefix match (`s11` ↔ `s11_x` on docs
 * that only populated the top-level section). Returns the first matching
 * SectionContent row or null.
 */
export function findMatchingSection<T extends { sectionId: string }>(
  catalogSectionId: string,
  sections: ReadonlyArray<T>,
): T | null {
  const exact = sections.find(s => s.sectionId === catalogSectionId)
  if (exact) return exact
  // §11 catalog entry matches a doc that only has §11.1, §11.2, etc. —
  // pick the first subsection as a representative "started" row.
  const prefix = sections.find(s => s.sectionId.startsWith(`${catalogSectionId}_`))
  return prefix ?? null
}

export type IchSectionStatus =
  | 'complete'
  | 'in_progress'
  | 'not_started'
  | 'waived'
  | 'warning'

export interface IchSectionReport {
  code:        string
  title:       string
  sectionId:   string
  status:      IchSectionStatus
  inDocument:  boolean         // false → no editor section to open
  conditional: boolean         // true → listed for information, not counted
  hasContent:  boolean         // the matched editor section holds real text
  wordCount:   number          // words in the matched section (0 when none)
  // Conditional (US-only) rows only: whether the project's submission
  // countries make the section required. Absent when the countries are unknown.
  requirement?: 'required' | 'not-required'
  progress:    IchSectionProgress
  waiver?: {
    waivedBy:     string
    waivedByName: string | null
    waivedAt:     string       // ISO
    reason:       string
    versionAtWaiver: string
  }
}

export interface IchE3Report {
  applicable:        boolean
  documentTitle:     string
  completionPercent: number
  completeSections:  number   // complete + waived (kept for older clients)
  completeCount:     number
  waivedCount:       number
  totalSections:     number
  sections:          IchSectionReport[]
}

/**
 * Pure helper — compute the per-section status map for an ICH E3 report.
 * The route layer loads SectionContent + waivers and hands them in; keeping
 * this pure lets the compliance PDF exporter reuse the same logic.
 *
 * Status rules:
 *   waived       — explicit waiver row exists for this section code
 *   complete     — ichStatus === 'complete' AND contentHtml non-empty
 *   warning      — ichStatus === 'complete' but the content was emptied
 *   in_progress  — contentHtml non-empty, ichStatus not yet 'complete'
 *   not_started  — no matching section row, or empty contentHtml
 *
 * A non-applicable document (anything but a full CSR) returns no rows.
 */
export function buildIchE3Report(args: {
  applicable?:    boolean
  documentTitle?: string
  submissionCountries?: ReadonlyArray<string>
  sections:  ReadonlyArray<{
    sectionId: string; contentHtml: string | null; ichStatus: string
    sectionNumber?: string; lastEditedAt?: Date | null; lastEditedByName?: string | null
  }>
  waivers:   ReadonlyArray<{ sectionCode: string; waivedBy: string; waivedByName?: string | null; waivedAt: Date; reason: string; versionAtWaiver: string }>
  // Feed the per-section progress only; omitted = none.
  openComments?:     ReadonlyArray<{ sectionRef: string; verdict?: string | null }>
  sourceReferences?: ReadonlyArray<{ sectionId: string }>
}): IchE3Report {
  const applicable    = args.applicable ?? true
  const documentTitle = args.documentTitle ?? ''
  if (!applicable) {
    return {
      applicable, documentTitle,
      completionPercent: 0, completeSections: 0, completeCount: 0, waivedCount: 0,
      totalSections: ICH_E3_MANDATORY_COUNT, sections: [],
    }
  }

  const waiverByCode = new Map(args.waivers.map(w => [w.sectionCode, w]))
  // An 'approve' verdict is stored as an open comment but needs no action.
  const openComments     = (args.openComments ?? []).filter(c => c.verdict !== 'approve').map(c => normalizeSectionRef(c.sectionRef))
  const sourceReferences = args.sourceReferences ?? []

  // Progress for one catalog section, over its row and all its subsection rows
  // (§11 covers s11, s11_4, …). `section` is the row the status is judged on.
  const progressFor = (catalogSectionId: string, section: typeof args.sections[number] | null): IchSectionProgress => {
    const group = args.sections.filter(s => s.sectionId === catalogSectionId || s.sectionId.startsWith(`${catalogSectionId}_`))
    const subRows = group.filter(s => s.sectionId !== catalogSectionId)
    const subsections = subRows.length > 0
      ? { total: subRows.length, completed: subRows.filter(s => s.ichStatus === 'complete' && hasSectionContent(s.contentHtml)).length }
      : undefined
    const numbers = new Set(group.flatMap(s => s.sectionNumber ? [normalizeSectionRef(s.sectionNumber)] : []))
    const ids     = new Set(group.map(s => s.sectionId))
    const facts: ProgressFacts = {
      hasContent:     hasSectionContent(section?.contentHtml),
      placeholders:   sectionPlaceholderCount(section?.contentHtml),
      markedComplete: section?.ichStatus === 'complete',
      subsections,
      openComments:   openComments.filter(ref => numbers.has(ref)).length,
    }
    const checks = ICH_PROGRESS_CHECKS.flatMap(c => {
      const passed = c.evaluate(facts)
      return passed === null ? [] : [{ key: c.key, passed }]
    })
    return {
      wordCount:        sectionWordCount(section?.contentHtml),
      minWords:         ICH_MIN_SECTION_WORDS,
      placeholders:     facts.placeholders,
      markedComplete:   facts.markedComplete,
      ...(subsections && { subsections }),
      openComments:     facts.openComments,
      sourceReferences: sourceReferences.filter(r => ids.has(r.sectionId)).length,
      lastEditedAt:     section?.lastEditedAt?.toISOString() ?? null,
      lastEditedByName: section?.lastEditedByName ?? null,
      checks,
      checksDone:       checks.filter(c => c.passed).length,
      checksTotal:      checks.length,
    }
  }

  const reports: IchSectionReport[] = []
  for (const def of ICH_E3_SECTIONS) {
    const conditional = def.conditional === true
    const section     = findMatchingSection(def.sectionId, args.sections)
    const waiver      = waiverByCode.get(def.code)
    const requirement = conditional && args.submissionCountries
      ? (args.submissionCountries.includes('US') ? 'required' as const : 'not-required' as const)
      : undefined
    // A US-only section the project must file is listed even before it exists.
    if (conditional && !section && !waiver && requirement !== 'required') continue

    // sectionId is the editor section "Open →" jumps to — the matched row's
    // id, so a doc holding only §11.4 opens s11_4 rather than a missing s11.
    const base = {
      code: def.code, title: def.title, sectionId: section?.sectionId ?? def.sectionId, inDocument: section !== null, conditional,
      hasContent: hasSectionContent(section?.contentHtml),
      wordCount:  sectionWordCount(section?.contentHtml),
      ...(requirement && { requirement }),
      progress:   progressFor(def.sectionId, section),
    }
    if (waiver) {
      reports.push({
        ...base,
        status: 'waived',
        waiver: {
          waivedBy:     waiver.waivedBy,
          waivedByName: waiver.waivedByName ?? null,
          waivedAt:     waiver.waivedAt.toISOString(),
          reason:       waiver.reason,
          versionAtWaiver: waiver.versionAtWaiver,
        },
      })
      continue
    }
    const markedComplete = section?.ichStatus === 'complete'
    let status: IchSectionStatus = 'not_started'
    if (hasSectionContent(section?.contentHtml)) status = markedComplete ? 'complete' : 'in_progress'
    else if (markedComplete) status = 'warning'
    reports.push({ ...base, status })
  }

  // "Complete" for the completion percent counts both complete + waived
  // rows — a waived item is a reviewer-signed decision that the section
  // doesn't apply, which is equivalent to done from a compliance view.
  // Conditional rows are informational and never move the percentage.
  const mandatory     = reports.filter(r => !r.conditional)
  const completeCount = mandatory.filter(r => r.status === 'complete').length
  const waivedCount   = mandatory.filter(r => r.status === 'waived').length
  const completedOrWaived = completeCount + waivedCount
  const completionPercent = ICH_E3_MANDATORY_COUNT === 0 ? 0 : Math.round((completedOrWaived / ICH_E3_MANDATORY_COUNT) * 100)

  return {
    applicable,
    documentTitle,
    completionPercent,
    completeSections: completedOrWaived,
    completeCount,
    waivedCount,
    totalSections:    ICH_E3_MANDATORY_COUNT,
    sections:         reports,
  }
}
