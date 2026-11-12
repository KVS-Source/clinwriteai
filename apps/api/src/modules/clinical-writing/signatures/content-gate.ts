// A signature chain can only open on a document that is actually written: no mandatory section may be
// empty or still hold a drafting marker ([TBD], [XX], [INSERT ...]) (CW-097). Before this, a document
// with 17 of its 18 sections empty reached Pending signature and could be signed.
//
//   - A full CSR: the 18 ICH E3 sections (the US-only §16.4 is not counted) must each have text and no
//     markers, unless a reviewer waived the section.
//   - Any other document type has no list of mandatory sections, so every section the document has counts.
//
// Pure: the route loads the rows and hands them in.

import {
  findMatchingSection, hasSectionContent, ICH_E3_SECTIONS, isIchE3Applicable, sectionPlaceholderCount,
} from '../ich-e3/catalog.js'

export interface ContentProblem {
  section: string                         // '§1 Title Page' or '3.2 Eligibility'
  reason: 'empty' | 'placeholders'
  placeholders?: number
}

export interface ContentGateResult { ok: boolean; problems: ContentProblem[] }

interface SectionRow { sectionId: string; sectionNumber?: string | null; sectionTitle?: string | null; contentHtml: string | null }

export function checkSignableContent(args: {
  documentType: string
  sections: ReadonlyArray<SectionRow>
  waivedCodes?: ReadonlyArray<string>
}): ContentGateResult {
  const problems: ContentProblem[] = []
  const judge = (label: string, html: string | null) => {
    if (!hasSectionContent(html)) { problems.push({ section: label, reason: 'empty' }); return }
    const placeholders = sectionPlaceholderCount(html)
    if (placeholders > 0) problems.push({ section: label, reason: 'placeholders', placeholders })
  }

  if (isIchE3Applicable(args.documentType)) {
    const waived = new Set(args.waivedCodes ?? [])
    for (const def of ICH_E3_SECTIONS) {
      if (def.conditional || waived.has(def.code)) continue
      judge(`${def.code} ${def.title}`, findMatchingSection(def.sectionId, args.sections)?.contentHtml ?? null)
    }
  } else {
    for (const s of args.sections) {
      judge([s.sectionNumber, s.sectionTitle].filter(Boolean).join(' ') || s.sectionId, s.contentHtml)
    }
  }
  return { ok: problems.length === 0, problems }
}

const SHOWN = 5

export function contentBlockedBody(result: ContentGateResult) {
  const parts = result.problems.map(p => p.reason === 'empty' ? `${p.section} (empty)` : `${p.section} (${p.placeholders} placeholder${p.placeholders === 1 ? '' : 's'} left)`)
  const list = parts.slice(0, SHOWN).join('; ') + (parts.length > SHOWN ? `; and ${parts.length - SHOWN} more` : '')
  return {
    error: 'content_incomplete',
    message: `The document can't go to signature yet: ${result.problems.length === 1 ? '1 section is empty or has' : `${result.problems.length} sections are empty or have`} placeholders left. ${list}.`,
    problemCount: result.problems.length,
    problems: result.problems,
  }
}
