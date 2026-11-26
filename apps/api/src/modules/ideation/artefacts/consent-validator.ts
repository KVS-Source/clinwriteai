// Consent / disclosure structural validator (Package E-5, migration 105).
// Fires AFTER the shared retry wrapper returns, on `patient_story`
// content, when the rewrite drops the recognisable Consent / Disclosure
// labels the narrative is expected to carry. Soft flag — the author
// decides; no retry (consent framing varies by legal regime and the
// AI rarely converges on a one-prompt fix).
//
// Convention (from the patient-story seed template):
//   Consent:            (verbatim restatement — "The patient has
//                        provided written consent for publication...")
//   Disclosures:        (COI + sponsor funding disclosures)
//   Patient Consent:    (same as Consent — HIPAA / informed-consent style)
//   Informed Consent:   (clinical-trial-style phrasing)
//   Conflict of Interest / COI: (author disclosures)
//
// At least ONE label must be present. Consent is a hard ethical
// obligation under ICMJE + most IRB conventions — dropping ALL of
// these in a published patient story is a compliance issue.
//
// Scope — only fires when item.docType === 'patient_story'.

const CONVENTIONAL_LABELS = [
  'Consent',
  'Disclosure',
  'Disclosures',
  'Patient Consent',
  'Informed Consent',
  'Conflict of Interest',
  'COI',
] as const
const LABEL_REQUIRED_MIN = 1

// Match "Consent:", "**Consent:**", "<strong>Consent:</strong>",
// "Consent —" (dash-separated). Case-insensitive. For acronym labels
// ("COI") require word-boundary + non-trailing-letter context to
// avoid matching "coil" / "coincidence" / etc.
function labelPresent(html: string, label: string): boolean {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const isAcronym = /^[A-Z]{2,5}$/.test(label)
  // Acronyms need an explicit non-letter after (plus optional :/—) so
  // they don't match a word they're embedded in. Longer labels only
  // need the standard delimiter.
  const tail = isAcronym ? `(?:[:：]|[-–—]|\\s)` : `\\s*(?:[:：]|[-–—]\\s)`
  const re = new RegExp(`\\b${escaped}${tail}`, 'i')
  return re.test(html)
}

export interface ConsentValidationResult {
  looksLikePatientStory: boolean
  labelsFound:           string[]
  missingLabels:         string[]
  structurallyValid:     boolean
}

/** Pure structural scan. Returns whether the HTML looks like it was
 *  authored as a patient story + whether at least one consent /
 *  disclosure label survived the rewrite. */
export function validateConsentDisclosure(html: string): ConsentValidationResult {
  if (!html || html.trim().length === 0) {
    return { looksLikePatientStory: false, labelsFound: [], missingLabels: [...CONVENTIONAL_LABELS], structurallyValid: true }
  }

  const labelsFound: string[] = []
  const missingLabels: string[] = []
  for (const label of CONVENTIONAL_LABELS) {
    if (labelPresent(html, label)) labelsFound.push(label)
    else missingLabels.push(label)
  }

  // "Looks like patient story" = any patient-first-person cue OR at
  // least one consent/disclosure label. Non-patient-story docTypes
  // are gated OUT at the caller, so this is just a sanity check for
  // empty / stubbed content.
  const plain = html.replace(/<[^>]+>/g, ' ')
  const firstPersonHit = /\b(?:I|my|me)\b/.test(plain)
  const looksLikePatientStory = labelsFound.length > 0 || firstPersonHit

  if (!looksLikePatientStory) {
    return { looksLikePatientStory: false, labelsFound, missingLabels, structurallyValid: true }
  }

  return {
    looksLikePatientStory: true,
    labelsFound,
    missingLabels,
    structurallyValid:     labelsFound.length >= LABEL_REQUIRED_MIN,
  }
}

/** Gating predicate — only fires on patient_story docType. */
export function isConsentGatedType(docType: string): boolean {
  return docType === 'patient_story'
}

export const __test__ = { labelPresent, CONVENTIONAL_LABELS, LABEL_REQUIRED_MIN }
