// PII scrub — redacts the most common structured PII patterns before the
// gateway passes a prompt to the LLM.
//
// Scope boundaries: this is intentionally dumb and conservative. It catches
// the "oh no I pasted a real email into the prompt" class of mistake. It
// does NOT replace an actual DLP engine — those are the Phase 5 compliance
// layer (SOC 2 + ISO 27001). Rule of thumb: if a human reviewer wouldn't
// catch the pattern at a glance, this regex probably won't either.
//
// Patterns scrubbed:
//   - Email addresses
//   - US SSNs (XXX-XX-XXXX)
//   - 10-digit phone numbers (loose; US+UK mobile-ish)
//   - Credit-card-ish 13-19 digit runs (with/without spaces or dashes)
//   - US MRN (Medical Record Number): typically 7-10 digits with 'MRN'
//     prefix or 'MRN:' label — the label-anchored form is what shows up
//     in clinical copy/paste
//   - NHS numbers (UK): 10 digits in 3-3-4 grouping with Mod-11 structure;
//     we loose-match the grouping and let the scrubber over-redact if a
//     non-NHS 10-digit tri-group sneaks in (over-redaction is the safe side)
//   - DEA numbers (US): 2 letters + 7 digits where char 1 is A/B/F/M/P/R/X
//     and char 2 is the registrant initial (any letter); loose-matched
//
// Each pattern replaces with a placeholder that preserves type so the LLM
// still understands "there was an MRN here" — important for structured
// outputs like "classify this message".

// Order matters: more specific label-anchored patterns run FIRST so a
// generic 10-digit phone match can't eat an MRN or NHS number before the
// specific pattern gets a chance to see the original digits. Email runs
// first because it's unambiguous.
const PATTERNS: ReadonlyArray<{ name: string; regex: RegExp; replacement: string }> = [
  { name: 'email', regex: /\b[\w.+-]+@[A-Za-z0-9-]+\.[A-Za-z0-9.-]+\b/g, replacement: '[REDACTED_EMAIL]' },
  { name: 'ssn', regex: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: '[REDACTED_SSN]' },
  // MRN — label-anchored form only (bare 7-10 digit runs collide with
  // many non-PHI identifiers like study IDs). Case-insensitive on label.
  { name: 'mrn', regex: /\b(?:MRN|Medical Record (?:Number|No\.?)|MR#)[\s:#]*\d{6,10}\b/gi, replacement: '[REDACTED_MRN]' },
  // NHS number — label-anchored only to avoid colliding with US phone
  // numbers which share the 3-3-4 shape. Proper Mod-11 validation would
  // disambiguate but is scope-later; the label requirement is the
  // conservative choice that minimises false negatives on real NHS data
  // (which is nearly always labelled in copy/paste) while never
  // false-positiving on a phone number.
  { name: 'nhs', regex: /\b(?:NHS(?:\s+(?:no\.?|number))?)[\s:#]*\d{3}[\s-]?\d{3}[\s-]?\d{4}\b/gi, replacement: '[REDACTED_NHS]' },
  // DEA number — 2 letters (first in registrant class set) + 7 digits.
  { name: 'dea', regex: /\b[ABFGMPRX][A-Z]\d{7}\b/g, replacement: '[REDACTED_DEA]' },
  { name: 'phone', regex: /\b(?:\+?\d{1,3}[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}\b/g, replacement: '[REDACTED_PHONE]' },
  { name: 'credit_card', regex: /\b(?:\d[ -]?){13,19}\b/g, replacement: '[REDACTED_CARD]' },
]

export interface ScrubResult {
  scrubbed: string
  piiFound: boolean
  categories: string[]      // list of pattern names that matched
}

export function scrubPii(input: string): ScrubResult {
  let out = input
  const categories: string[] = []
  for (const p of PATTERNS) {
    if (p.regex.test(out)) {
      categories.push(p.name)
      // Reset lastIndex because the test() above advances it on 'g' regexes.
      p.regex.lastIndex = 0
      out = out.replace(p.regex, p.replacement)
      p.regex.lastIndex = 0
    }
  }
  return { scrubbed: out, piiFound: categories.length > 0, categories }
}
