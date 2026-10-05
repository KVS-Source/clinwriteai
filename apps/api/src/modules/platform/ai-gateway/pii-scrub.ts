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
//
// Each pattern replaces with a placeholder that preserves type so the LLM
// still understands "there was an email here" — important for structured
// outputs like "classify this message".

const PATTERNS: ReadonlyArray<{ name: string; regex: RegExp; replacement: string }> = [
  { name: 'email', regex: /\b[\w.+-]+@[A-Za-z0-9-]+\.[A-Za-z0-9.-]+\b/g, replacement: '[REDACTED_EMAIL]' },
  { name: 'ssn', regex: /\b\d{3}-\d{2}-\d{4}\b/g, replacement: '[REDACTED_SSN]' },
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
