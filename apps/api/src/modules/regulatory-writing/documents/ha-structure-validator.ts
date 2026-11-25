// HA (Health Authority) response structural validator (Package R-5,
// migration 105). Fires AFTER the shared retry wrapper returns, on
// ha_response_narrative content, when the rewrite drops the
// conventional labels the response is expected to carry. Soft flag —
// author decides; no retry (HA responses are formal + heterogeneous,
// retry loops aren't guaranteed to converge).
//
// Convention (from the HA correspondence workflow seed data):
//   Question:       (verbatim restatement of the HA question)
//   Response:       (the applicant's answer)
//   Rationale:      (supporting evidence summary)
//   Dossier Impact: (which modules change, if any)
//   References:     (CSR tables, protocol sections, label sections)
//
// Tolerant threshold: at least 3 of the 5 conventional labels present
// to count as structurally valid. Authors may legitimately drop
// "References:" when no new citation is introduced, or "Dossier Impact:"
// when the response is clarifying only.
//
// Scope — only fires when item.type === 'ha_response_narrative'.

const CONVENTIONAL_LABELS = ['Question', 'Response', 'Rationale', 'Dossier Impact', 'References'] as const
const LABEL_REQUIRED_MIN  = 3

// Match "Question:", "**Question:**", "<strong>Question:</strong>",
// "Question —" (dash-separated). Case-insensitive.
function labelPresent(html: string, label: string): boolean {
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  // Accept: label followed by :, —, –, - (any dash), or ) with
  // optional surrounding HTML tags / whitespace.
  const re = new RegExp(`\\b${escaped}\\s*(?:[:：]|[-–—]\\s)`, 'i')
  return re.test(html)
}

export interface HaStructureResult {
  looksLikeHaResponse: boolean
  labelsFound:         string[]
  missingLabels:       string[]
  structurallyValid:   boolean
}

/** Pure structural scan. Returns whether the HTML looks like it was
 *  authored as an HA response + whether enough conventional labels
 *  survived the rewrite. */
export function validateHaResponseStructure(html: string): HaStructureResult {
  if (!html || html.trim().length === 0) {
    return { looksLikeHaResponse: false, labelsFound: [], missingLabels: [...CONVENTIONAL_LABELS], structurallyValid: true }
  }

  const labelsFound: string[] = []
  const missingLabels: string[] = []
  for (const label of CONVENTIONAL_LABELS) {
    if (labelPresent(html, label)) labelsFound.push(label)
    else missingLabels.push(label)
  }

  // "Looks like HA response" = at least one conventional label OR a
  // question-mark pattern that implies HA correspondence framing.
  const looksLikeHaResponse = labelsFound.length > 0 || /\?/.test(html.replace(/<[^>]+>/g, ' '))

  // Only non-HA content gets a free pass. HA content is scored
  // against the threshold.
  if (!looksLikeHaResponse) {
    return { looksLikeHaResponse: false, labelsFound, missingLabels, structurallyValid: true }
  }

  return {
    looksLikeHaResponse: true,
    labelsFound,
    missingLabels,
    structurallyValid:   labelsFound.length >= LABEL_REQUIRED_MIN,
  }
}

/** Gating predicate — only fires on HA response narratives. */
export function isHaGatedType(type: string): boolean {
  return type === 'ha_response_narrative'
}

// Exposed for unit testing the pure label matcher.
export const __test__ = { labelPresent, CONVENTIONAL_LABELS, LABEL_REQUIRED_MIN }
