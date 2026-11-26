// Disclaimer presence validator (Package E-5, migration 105).
// Fires AFTER the shared retry wrapper returns, on
// `scientific_exchange_note` and `congress_summary` content, when the
// rewrite drops the non-promotional / sponsor-views boilerplate that
// MLR + medical-affairs conventions require. Soft flag — the author
// decides; no retry (disclaimer wording is a legal/MLR call, not
// something the AI reliably converges on).
//
// Common phrasings (checked case-insensitively, any one satisfies):
//   - "represents the views of the sponsor"
//   - "not promotional"
//   - "for scientific exchange only"
//   - "no off-label"
//   - "opinions expressed"
//   - "educational purposes"
//   - "investigational use"
//   - "unapproved indication"
//
// Scope — only fires when item.docType is
// `scientific_exchange_note` or `congress_summary`.

const DISCLAIMER_PHRASES = [
  'represents the views of the sponsor',
  'not promotional',
  'for scientific exchange only',
  'scientific exchange only',
  'no off-label',
  'off-label use',
  'opinions expressed',
  'educational purposes',
  'investigational use',
  'unapproved indication',
  'views of the author',
  'does not constitute promotion',
] as const

function phrasePresent(text: string, phrase: string): boolean {
  return text.toLowerCase().includes(phrase.toLowerCase())
}

export interface DisclaimerValidationResult {
  looksLikeDisclaimerContent: boolean
  phrasesFound:               string[]
  structurallyValid:          boolean
}

/** Pure structural scan. Returns whether the HTML carries any
 *  recognisable disclaimer phrase. */
export function validateDisclaimer(html: string): DisclaimerValidationResult {
  if (!html || html.trim().length === 0) {
    return { looksLikeDisclaimerContent: false, phrasesFound: [], structurallyValid: true }
  }
  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ')
  const phrasesFound: string[] = []
  for (const phrase of DISCLAIMER_PHRASES) {
    if (phrasePresent(text, phrase)) phrasesFound.push(phrase)
  }
  return {
    looksLikeDisclaimerContent: true,
    phrasesFound,
    structurallyValid:          phrasesFound.length >= 1,
  }
}

/** Gating predicate — fires on scientific exchange + congress summary. */
export function isDisclaimerGatedType(docType: string): boolean {
  return docType === 'scientific_exchange_note' || docType === 'congress_summary'
}

export const __test__ = { phrasePresent, DISCLAIMER_PHRASES }
