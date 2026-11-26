// Press-release structural validator (Package E-5, migration 105).
// Fires AFTER the shared retry wrapper returns, on `press_release`
// content, when the AP press-release conventions dissolve. Soft flag
// — authors sometimes legitimately omit a dateline (web-first
// releases) or boilerplate (internal drafts), so the threshold is
// "at least 3 of 5 recognisable structural elements present."
//
// Elements scanned (any English AP-style release):
//   - headline     : the first <h1> / <h2> / <h3> OR a bold-prominent
//                    first line that reads as a headline
//   - dateline     : "CITY, Month DD, YYYY" line (AP convention)
//   - body         : at least 2 paragraphs
//   - boilerplate  : an "About <Sponsor>" / "About the Company"
//                    section near the end
//   - contact      : "Contact:" / "Media Contact:" block
//
// Scope — only fires when item.docType === 'press_release'.

// Dateline shapes (AP + Reuters conventions):
//   NEW YORK, March 15, 2026 — ...     (comma between city and date)
//   SAN FRANCISCO — March 15, 2026 — ...   (em-dash between city and date)
//   CHICAGO (Reuters) March 15, 2026 — ...   (wire tag between city and date)
// The regex only requires the CITY token and the Month DD, YYYY stamp
// to be adjacent via one of comma / dash / parenthetical.
const DATELINE_RE = /\b[A-Z][A-Z][A-Z\s,.'-]*?[,—–\-)]\s*(?:January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec)\.?\s+\d{1,2},?\s+\d{4}/

const BOILERPLATE_RE = /\bAbout\s+(?:[A-Z][\w&'.-]*\s*){1,6}/

const CONTACT_RE = /\b(?:Media\s+Contact|Press\s+Contact|Contact)\s*[:：]/i

const HEADLINE_HTML_RE = /<(h[1-3])\b[^>]*>[^<]{10,}/i
const HEADLINE_BOLD_FIRST_RE = /^\s*<(?:p|div)[^>]*>\s*(?:<(?:strong|b)>\s*){1,3}[^<]{10,}/i

export interface PressReleaseValidationResult {
  elementsFound:     string[]
  missingElements:   string[]
  structurallyValid: boolean
}

const ALL_ELEMENTS = ['headline', 'dateline', 'body', 'boilerplate', 'contact'] as const
const ELEMENT_REQUIRED_MIN = 3

function hasHeadline(html: string): boolean {
  if (HEADLINE_HTML_RE.test(html)) return true
  if (HEADLINE_BOLD_FIRST_RE.test(html)) return true
  return false
}

function hasBody(html: string): boolean {
  const paragraphMatches = html.match(/<p\b[^>]*>[\s\S]*?<\/p>/gi) ?? []
  const nonEmpty = paragraphMatches.filter(p => p.replace(/<[^>]+>/g, '').trim().length > 20)
  return nonEmpty.length >= 2
}

/** Pure structural scan. Checks for 5 recognisable AP press-release
 *  elements and returns which were found. */
export function validatePressReleaseStructure(html: string): PressReleaseValidationResult {
  if (!html || html.trim().length === 0) {
    return { elementsFound: [], missingElements: [...ALL_ELEMENTS], structurallyValid: true }
  }
  const plain = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
  const elementsFound: string[] = []
  if (hasHeadline(html))          elementsFound.push('headline')
  if (DATELINE_RE.test(plain))    elementsFound.push('dateline')
  if (hasBody(html))              elementsFound.push('body')
  if (BOILERPLATE_RE.test(plain)) elementsFound.push('boilerplate')
  if (CONTACT_RE.test(plain))     elementsFound.push('contact')
  const missingElements = ALL_ELEMENTS.filter(e => !elementsFound.includes(e))
  return {
    elementsFound,
    missingElements,
    structurallyValid: elementsFound.length >= ELEMENT_REQUIRED_MIN,
  }
}

/** Gating predicate — only fires on press_release docType. */
export function isPressReleaseGatedType(docType: string): boolean {
  return docType === 'press_release'
}

export const __test__ = { ALL_ELEMENTS, ELEMENT_REQUIRED_MIN, DATELINE_RE, BOILERPLATE_RE, CONTACT_RE }
