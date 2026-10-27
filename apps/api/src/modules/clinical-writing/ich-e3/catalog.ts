// Canonical ICH E3 §1–§16 mandatory section catalog (FR-A-026).
//
// 18 sections — the top 15 are always required; §16.1–§16.3 round out the
// appendix. §16.4 (US-only Individual Patient Data Listings) is deliberately
// omitted from the mandatory set — it's conditional on US submission and
// surfaces as a waiver rather than as a baseline row.
//
// `sectionId` maps each ICH code to the editor's stable section key so the
// "Open in editor →" link in the panel always resolves (previously only §11
// and §12 were wired, via a hard-coded map). The format matches the editor's
// section id scheme: `s{N}` for top-level, `s{N}_{sub}` for nested.

export interface IchSectionDef {
  code:      string            // '§1', '§16.3', …
  sectionId: string            // 's1', 's16_3', …
  title:     string
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
]

/** Fast lookup by code — used by the waive endpoint to reject bad input. */
export const ICH_E3_SECTION_CODES: ReadonlySet<string> = new Set(ICH_E3_SECTIONS.map(s => s.code))

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
  code:       string
  title:      string
  sectionId:  string
  status:     IchSectionStatus
  waiver?: {
    waivedBy: string
    waivedAt: string           // ISO
    reason:   string
    versionAtWaiver: string
  }
}

export interface IchE3Report {
  completionPercent: number
  completeSections:  number
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
 *   in_progress  — contentHtml non-empty, ichStatus not yet 'complete'
 *   not_started  — no matching section row, or empty contentHtml
 */
export function buildIchE3Report(args: {
  sections:  ReadonlyArray<{ sectionId: string; contentHtml: string | null; ichStatus: string }>
  waivers:   ReadonlyArray<{ sectionCode: string; waivedBy: string; waivedAt: Date; reason: string; versionAtWaiver: string }>
}): IchE3Report {
  const waiverByCode = new Map(args.waivers.map(w => [w.sectionCode, w]))

  const reports: IchSectionReport[] = ICH_E3_SECTIONS.map(def => {
    const waiver = waiverByCode.get(def.code)
    if (waiver) {
      return {
        code: def.code,
        title: def.title,
        sectionId: def.sectionId,
        status: 'waived',
        waiver: {
          waivedBy: waiver.waivedBy,
          waivedAt: waiver.waivedAt.toISOString(),
          reason:   waiver.reason,
          versionAtWaiver: waiver.versionAtWaiver,
        },
      }
    }
    const section = findMatchingSection(def.sectionId, args.sections)
    const hasContent = Boolean(section && section.contentHtml && section.contentHtml.trim() !== '' && section.contentHtml.trim() !== '<p></p>')
    let status: IchSectionStatus = 'not_started'
    if (hasContent) {
      status = section!.ichStatus === 'complete' ? 'complete' : 'in_progress'
    }
    return {
      code: def.code,
      title: def.title,
      sectionId: def.sectionId,
      status,
    }
  })

  // "Complete" for the completion percent counts both complete + waived
  // rows — a waived item is a reviewer-signed decision that the section
  // doesn't apply, which is equivalent to done from a compliance view.
  const completedOrWaived = reports.filter(r => r.status === 'complete' || r.status === 'waived').length
  const completionPercent = ICH_E3_SECTIONS.length === 0 ? 0 : Math.round((completedOrWaived / ICH_E3_SECTIONS.length) * 100)

  return {
    completionPercent,
    completeSections: completedOrWaived,
    totalSections:    ICH_E3_SECTIONS.length,
    sections:         reports,
  }
}
