// CTD (Common Technical Document) structural cross-reference validator
// (Package RD-2). Pure helper; no IO.
//
// Scope — the full "does this document carry §2.5.1 through §2.5.7"
// structure check is deferred (vendor Extedo / Lorenz do it against a
// real eCTD DTD). What we CAN check here, per-section, is whether the
// AI invented a §X.Y.Z or "Section X.Y.Z" cross-reference that doesn't
// map to a canonical ICH subsection for the document's CTD module.
//
// Catches a common AI drift: on a CTD M2.5 rewrite the model will
// occasionally invent "§2.5.9" or "Section 2.5.1.3.4" that don't
// exist in the ICH M4E spec. The shared `validateRefPreservation`
// (migration 104 Package 4) only catches refs that were DROPPED
// from the pre-call body — it has no notion of ICH canonical sets.
// This validator fills that gap for CTD content.
//
// Design:
//   - Gated by docType (only fires on ctd_m*). Other docTypes get a
//     pass through — no validator noise on cover letters, HA
//     responses, risk-benefit statements, etc.
//   - Extracts the module path from the docType (ctd_m2_5_* → '2.5').
//   - For each §/Section ref in the new HTML:
//       * If the ref STARTS with a different CTD module (e.g. "4.2.3"
//         on a M2.5 document), ignore — cross-module refs are legit.
//       * If the ref shares the document's module path, verify it
//         matches one of the canonical ICH subsection prefixes.
//   - Previously-present refs (in the pre-call body) are ALSO ignored
//     — the author may have authored a ref outside the canonical set
//     for a legitimate reason; the validator only flags INVENTED
//     non-canonical refs.
//
// Soft flag — the author decides. No retry: inventing a subsection
// number is a cosmetic drift and retry loops don't reliably converge.

/* eslint-disable security/detect-non-literal-regexp */

// ICH M4 canonical subsection prefixes, per CTD module.
// Entries are PREFIXES — a ref like "2.5.3.2" is valid because it
// starts with "2.5.3". M2.4 narrative overview has no canonical
// numbered subsections, so M2.4 documents skip the check.
//
// References:
//   ICH M4Q R1 — Quality (Module 3 / 2.3)
//   ICH M4S R2 — Safety (Module 4 / 2.4 / 2.6)
//   ICH M4E R2 — Efficacy (Module 5 / 2.5 / 2.7)
const CTD_CANONICAL_SUBSECTIONS: Readonly<Record<string, readonly string[]>> = {
  '2.3': ['2.3',  '2.3.S', '2.3.P', '2.3.A', '2.3.R'],
  '2.5': ['2.5',  '2.5.1', '2.5.2', '2.5.3', '2.5.4', '2.5.5', '2.5.6', '2.5.7'],
  '2.6': ['2.6',  '2.6.1', '2.6.2', '2.6.3', '2.6.4', '2.6.5', '2.6.6', '2.6.7'],
  '2.7': ['2.7',  '2.7.1', '2.7.2', '2.7.3', '2.7.4', '2.7.5', '2.7.6'],
}

// Capture §/Section X.Y[.Z]... refs. The shared must-preserve regex
// uses similar patterns; the copy here captures just the numeric body
// (dropping the "§" / "Section " prefix) so we can match prefixes
// directly.
// Segments after the first can be digit (2.5.3) or letter (2.3.S, 2.3.P)
// — QOS uses letter-coded top children per ICH M4Q.
const CTD_REF_RE = /(?:§\s?|\bSection\s+)(\d+(?:\.[A-Za-z0-9]+)+)/g

function htmlToText(html: string): string {
  if (!html) return ''
  return html.replace(/<[^>]+>/g, ' ').replace(/&nbsp;/gi, ' ')
}

/** Resolve the CTD module path ("2.5", "2.7", ...) from a docType
 *  like "ctd_m2_5_clinical_overview". Returns null when the docType
 *  isn't a CTD module docType (cover_letter, ha_response_narrative,
 *  risk_benefit_statement, qos, etc.) or doesn't have a canonical
 *  subsection set (M2.4 narrative overview). */
export function ctdModulePath(docType: string): string | null {
  // Match ctd_m<major>_<minor>[_rest]. Produce "<major>.<minor>".
  const m = /^ctd_m(\d+)_(\d+)/i.exec(docType)
  if (!m) return null
  const key = `${m[1]}.${m[2]}`
  return key in CTD_CANONICAL_SUBSECTIONS ? key : null
}

export interface CtdValidationResult {
  gated:              boolean
  modulePath:         string | null
  invalidRefs:        string[]      // refs the AI invented that don't match canonical ICH set
  structurallyValid:  boolean
}

/** Scan the rewritten HTML for CTD-style cross-refs and flag ones
 *  that share the document's module prefix but aren't on the ICH
 *  canonical list AND weren't already present in the pre-call body.
 *
 *  @param html        the rewritten section body (post-AI)
 *  @param preCallHtml the section body before the AI call
 *  @param docType     the RegulatoryDocument.docType
 */
export function validateCtdStructure(html: string, preCallHtml: string, docType: string): CtdValidationResult {
  const modulePath = ctdModulePath(docType)
  if (!modulePath) {
    return { gated: false, modulePath: null, invalidRefs: [], structurallyValid: true }
  }

  const canonical = CTD_CANONICAL_SUBSECTIONS[modulePath]!
  const afterText = htmlToText(html)
  const beforeText = htmlToText(preCallHtml ?? '')

  // Collect refs already present in the pre-call body — we never
  // flag these as invented (authors may legitimately use a
  // non-canonical form the validator doesn't know about).
  const preCallRefs = new Set<string>()
  for (const m of beforeText.matchAll(CTD_REF_RE)) preCallRefs.add(m[1]!)

  const invalidRefs = new Set<string>()
  for (const m of afterText.matchAll(CTD_REF_RE)) {
    const ref = m[1]!
    if (preCallRefs.has(ref)) continue

    // Only check refs that share the document's module top. Refs
    // to other modules (e.g. "4.2.3" on a M2.5 doc) are legit
    // cross-module pointers.
    if (!ref.startsWith(`${modulePath}.`) && ref !== modulePath) continue

    // Match against canonical entries. Rules:
    //   - The module top itself (e.g. "2.5") is canonical only as an
    //     exact match — it must NOT prefix-match deeper refs, else
    //     every made-up "2.5.99" would silently pass.
    //   - Deeper canonical subsections (e.g. "2.5.3") are prefix
    //     matches — so "2.5.3.2.1" is valid because it extends 2.5.3.
    const matches = canonical.some(prefix =>
      prefix === modulePath
        ? ref === prefix
        : ref === prefix || ref.startsWith(`${prefix}.`),
    )
    if (!matches) invalidRefs.add(ref)
  }

  const refs = [...invalidRefs]
  return {
    gated:              true,
    modulePath,
    invalidRefs:        refs,
    structurallyValid:  refs.length === 0,
  }
}

/** Gating predicate — only CTD module docTypes with a canonical
 *  subsection set go through the validator. */
export function isCtdGatedType(docType: string): boolean {
  return ctdModulePath(docType) !== null
}

export const __test__ = { CTD_CANONICAL_SUBSECTIONS, CTD_REF_RE }
