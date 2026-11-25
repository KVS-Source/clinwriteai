// Unit tests for the deterministic post-generation validators. These sit
// between the AI call and the author — correctness is load-bearing.

import { describe, expect, it } from 'vitest'
import { extractManifest } from './must-preserve.js'
import {
  hasHardFailure,
  renderRetryFeedback,
  runAllValidators,
  validateAcronymConsistency,
  validateCitationGrounding,
  validateNumericPreservation,
  validateRefPreservation,
} from './ai-validators.js'

const beforeBody = `
  <p>Per protocol NCT12345678, the dose was 25 mg/kg daily for 12 weeks in n=120 subjects (p<0.05).
  See §4.2.1 and Table 3 for baseline. Adverse event (AE) rates mirrored [Smith 2023].</p>
`.trim()

describe('validateRefPreservation — HARD on any dropped marker', () => {
  it('flags when a cross-ref is dropped', () => {
    const before = extractManifest(beforeBody)
    const after = `<p>The dose was 25 mg/kg daily. See Table 3 for baseline. (AE) rates mirrored [Smith 2023]. NCT12345678.</p>`
    const out = validateRefPreservation(before, after)
    expect(out).toHaveLength(1)
    expect(out[0]!.code).toBe('dropped_cross_ref')
    expect(out[0]!.severity).toBe('hard')
    expect((out[0]!.details.crossRefs as string[])).toContain('§4.2.1')
  })

  it('flags when a citation is dropped', () => {
    const before = extractManifest(beforeBody)
    const after = `<p>Dose 25 mg/kg daily for 12 weeks. n=120. p<0.05. See §4.2.1 and Table 3. (AE). NCT12345678.</p>`
    const out = validateRefPreservation(before, after)
    expect(out).toHaveLength(1)
    expect((out[0]!.details.citations as string[])).toContain('[Smith 2023]')
  })

  it('flags when a study id is dropped', () => {
    const before = extractManifest(beforeBody)
    const after = `<p>25 mg/kg for 12 weeks in n=120 (p<0.05). See §4.2.1, Table 3. (AE) mirrored [Smith 2023].</p>`
    const out = validateRefPreservation(before, after)
    expect(out).toHaveLength(1)
    expect((out[0]!.details.studyIds as string[])).toContain('NCT12345678')
  })

  it('no flag when all refs survive', () => {
    const before = extractManifest(beforeBody)
    const after = beforeBody
    expect(validateRefPreservation(before, after)).toEqual([])
  })
})

describe('validateCitationGrounding — HARD on new citations not in attached sources', () => {
  it('flags invented author-year citations when the surname is not in attached sources', () => {
    const before = extractManifest(`<p>Earlier work demonstrated the effect.</p>`)
    const after  = `<p>Earlier work demonstrated the effect [Jones 2024].</p>`
    const out = validateCitationGrounding(before, after, { authorSurnames: ['Smith'] })
    expect(out).toHaveLength(1)
    expect(out[0]!.code).toBe('invented_citation')
    expect((out[0]!.details.citations as string[])).toContain('[Jones 2024]')
  })

  it('accepts author-year citations whose surname IS in attached sources', () => {
    const before = extractManifest(`<p>Earlier work demonstrated the effect.</p>`)
    const after  = `<p>Earlier work demonstrated the effect [Jones 2024].</p>`
    const out = validateCitationGrounding(before, after, { authorSurnames: ['Jones'] })
    expect(out).toEqual([])
  })

  it('accepts citations whose token is on allowedTokens', () => {
    const before = extractManifest(`<p>Earlier work demonstrated the effect.</p>`)
    const after  = `<p>Earlier work demonstrated the effect [cite:p_abc123].</p>`
    const out = validateCitationGrounding(before, after, { allowedTokens: ['[cite:p_abc123]'] })
    expect(out).toEqual([])
  })

  it('ignores citations that were already in the pre-call body (not "new")', () => {
    const before = extractManifest(`<p>Earlier work [Smith 2023].</p>`)
    const after  = `<p>Earlier work [Smith 2023].</p>`
    const out = validateCitationGrounding(before, after, {})
    expect(out).toEqual([])
  })
})

describe('validateNumericPreservation — SOFT on dropped numbers', () => {
  it('flags numbers present in before and absent in after, but severity is soft', () => {
    const before = extractManifest(beforeBody)
    const after  = `<p>Dose daily for 12 weeks in n=120 subjects (p<0.05). See §4.2.1, Table 3. [Smith 2023]. (AE). NCT12345678.</p>`
    const out = validateNumericPreservation(before, after)
    expect(out).toHaveLength(1)
    expect(out[0]!.severity).toBe('soft')
    expect(out[0]!.code).toBe('number_drift')
    const dropped = out[0]!.details.numbers as Array<{ was: string; context: string }>
    expect(dropped.some(n => n.was === '25 mg/kg')).toBe(true)
  })
})

describe('validateAcronymConsistency — SOFT on undefined acronyms', () => {
  it('flags an acronym used in after but never defined, excluding allowlist', () => {
    const before = extractManifest(`<p>Adverse event (AE) in subjects.</p>`)
    const after  = `<p>AE and ECG measurements; the FDA was informed.</p>`
    const out = validateAcronymConsistency(before, after)
    expect(out).toHaveLength(1)
    expect(out[0]!.severity).toBe('soft')
    expect((out[0]!.details.acronyms as string[])).toContain('ECG')
    expect((out[0]!.details.acronyms as string[])).not.toContain('AE')
    expect((out[0]!.details.acronyms as string[])).not.toContain('FDA')
  })
})

describe('runAllValidators — orchestrator + hasHardFailure + renderRetryFeedback', () => {
  it('returns hard results first and passes through soft results', () => {
    const before = extractManifest(beforeBody)
    const after  = `<p>Dose 25 mg/kg for 12 weeks. n=120. p<0.05. See §4.2.1, Table 3. (AE). [Smith 2023]. NCT12345678. Also ECG was recorded.</p>`
    const out = runAllValidators({ before, afterHtml: after, attached: {} })
    // ECG is undefined → soft flag only; no hard failures here.
    expect(hasHardFailure(out)).toBe(false)
    expect(out.some(r => r.code === 'undefined_acronym')).toBe(true)
  })

  it('escalates to retry when a hard flag fires', () => {
    const before = extractManifest(beforeBody)
    const after  = `<p>25 mg/kg for 12 weeks. n=120. (AE). NCT12345678.</p>`  // dropped §4.2.1, Table 3, [Smith 2023]
    const out = runAllValidators({ before, afterHtml: after, attached: {} })
    expect(hasHardFailure(out)).toBe(true)
    const fb = renderRetryFeedback(out)
    expect(fb).toContain('dropped')
    expect(fb).toContain('§4.2.1')
    expect(fb).toContain('[Smith 2023]')
  })

  it('renderRetryFeedback is empty-ish when no hard flags (header only)', () => {
    const fb = renderRetryFeedback([
      { code: 'number_drift', severity: 'soft', details: { numbers: [] } },
    ])
    // Just the header line — no "- …" bullet for soft flags
    expect(fb.split('\n')).toHaveLength(1)
    expect(fb).not.toContain('dropped')
    expect(fb).not.toContain('invented')
  })
})
