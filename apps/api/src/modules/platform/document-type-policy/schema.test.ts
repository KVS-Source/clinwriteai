// Unit tests for the Zod shapes + the pure prompt-assembly helpers.

import { describe, expect, it } from 'vitest'
import {
  bestPracticeDigestSchema,
  principleSchema,
  renderSectionRules,
  renderWholeDocPrinciples,
  sectionRulesSchema,
  type BestPracticeDigest,
  type SectionRules,
} from './schema.js'

describe('principleSchema / bestPracticeDigestSchema', () => {
  it('accepts whole-doc + section-key scopes', () => {
    expect(principleSchema.safeParse({ scope: 'whole-doc', severity: 'must',   text: 'x' }).success).toBe(true)
    expect(principleSchema.safeParse({ scope: 'section:6.2', severity: 'nice', text: 'y' }).success).toBe(true)
    expect(principleSchema.safeParse({ scope: 'section:s6_2', severity: 'should', text: 'y' }).success).toBe(true)
  })

  it('rejects an arbitrary scope string', () => {
    expect(principleSchema.safeParse({ scope: 'doc', severity: 'must', text: 'x' }).success).toBe(false)
    expect(principleSchema.safeParse({ scope: 'section:', severity: 'must', text: 'x' }).success).toBe(false)
  })

  it('rejects an unknown severity', () => {
    expect(principleSchema.safeParse({ scope: 'whole-doc', severity: 'critical', text: 'x' }).success).toBe(false)
  })

  it('digest defaults principles to []', () => {
    const r = bestPracticeDigestSchema.safeParse({})
    expect(r.success).toBe(true)
    if (r.success) expect(r.data.principles).toEqual([])
  })

  it('digest rejects unknown top-level keys', () => {
    const r = bestPracticeDigestSchema.safeParse({ principles: [], unknown: 'x' })
    expect(r.success).toBe(false)
  })
})

describe('sectionRulesSchema', () => {
  it('accepts a dict of section keys to rule arrays', () => {
    const r = sectionRulesSchema.safeParse({
      's6_2': [{ severity: 'must', text: 'Use a numbered list.' }],
      's9':   [{ severity: 'should', text: 'Lead with HR + 95% CI.' }],
    })
    expect(r.success).toBe(true)
  })
})

describe('renderWholeDocPrinciples', () => {
  it('returns empty string when there are no whole-doc rules', () => {
    const d: BestPracticeDigest = { principles: [{ scope: 'section:6.2', severity: 'must', text: 'x' }] }
    expect(renderWholeDocPrinciples(d)).toBe('')
  })

  it('renders must > should > nice ordering + severity prefix', () => {
    const d: BestPracticeDigest = {
      principles: [
        { scope: 'whole-doc', severity: 'nice',   text: 'C' },
        { scope: 'whole-doc', severity: 'must',   text: 'A' },
        { scope: 'whole-doc', severity: 'should', text: 'B' },
      ],
    }
    expect(renderWholeDocPrinciples(d)).toBe('[MUST] A\n[SHOULD] B\n[NICE] C')
  })

  it('filters out non-whole-doc rules', () => {
    const d: BestPracticeDigest = {
      principles: [
        { scope: 'whole-doc',   severity: 'must', text: 'A' },
        { scope: 'section:6.2', severity: 'must', text: 'skip' },
      ],
    }
    expect(renderWholeDocPrinciples(d)).toBe('[MUST] A')
  })
})

describe('renderSectionRules', () => {
  it('returns empty when no digest or rules apply to this section', () => {
    expect(renderSectionRules('s9', { principles: [] }, {})).toBe('')
  })

  it('merges digest section-scoped principles with explicit sectionRules', () => {
    const digest: BestPracticeDigest = {
      principles: [
        { scope: 'section:s6_2', severity: 'must',   text: 'From digest' },
        { scope: 'whole-doc',    severity: 'must',   text: 'Not here' },
      ],
    }
    const rules: SectionRules = {
      s6_2: [{ severity: 'should', text: 'From explicit rules' }],
    }
    const out = renderSectionRules('s6_2', digest, rules)
    // must before should
    expect(out).toBe('[MUST] From digest\n[SHOULD] From explicit rules')
  })

  it('does not match a different section key', () => {
    const digest: BestPracticeDigest = {
      principles: [{ scope: 'section:s6_2', severity: 'must', text: 'A' }],
    }
    expect(renderSectionRules('s9', digest, {})).toBe('')
  })
})
