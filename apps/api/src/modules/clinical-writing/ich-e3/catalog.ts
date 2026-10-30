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
  sections:  ReadonlyArray<{ sectionId: string; contentHtml: string | null; ichStatus: string }>
  waivers:   ReadonlyArray<{ sectionCode: string; waivedBy: string; waivedByName?: string | null; waivedAt: Date; reason: string; versionAtWaiver: string }>
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

  const reports: IchSectionReport[] = []
  for (const def of ICH_E3_SECTIONS) {
    const conditional = def.conditional === true
    const section     = findMatchingSection(def.sectionId, args.sections)
    const waiver      = waiverByCode.get(def.code)
    if (conditional && !section && !waiver) continue

    // sectionId is the editor section "Open →" jumps to — the matched row's
    // id, so a doc holding only §11.4 opens s11_4 rather than a missing s11.
    const base = { code: def.code, title: def.title, sectionId: section?.sectionId ?? def.sectionId, inDocument: section !== null, conditional }
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
