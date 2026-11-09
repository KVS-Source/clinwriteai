// renderPolicyPromptBlock must produce identical output on the API side
// (/ai-suggest) and the worker side (initial-draft). They sit in two
// independent packages; the worker file is imported directly here so
// drift between them fails CI, not production.

import { describe, expect, it } from 'vitest'
import { renderPolicyPromptBlock as apiRender, type PolicyRowForAi as ApiPolicy } from './resolve.js'
import {
  renderPolicyPromptBlock as workerRender,
  type PolicyRowForAi as WorkerPolicy,
} from '../../../../../worker/src/jobs/policy-prompt.js'

const SAMPLE_POLICY = {
  id:        'pol-1',
  docType:   'protocol',
  version:   3,
  smePrompt: 'You are a Clinical Protocol subject-matter expert. Follow ICH E6(R3).',
  bestPracticeDigest: {
    principles: [
      { scope: 'whole-doc',    severity: 'must'   as const, text: 'Follow ICH M11 structural register throughout.' },
      { scope: 'section:s6_2', severity: 'must'   as const, text: 'Numbered list, one inclusion criterion per line.' },
      { scope: 'whole-doc',    severity: 'nice'   as const, text: 'Prefer active voice.' },
      { scope: 'whole-doc',    severity: 'should' as const, text: 'Methods and Results sections should be concise.' },
      { scope: 'section:s6_2', severity: 'should' as const, text: 'Cross-reference exclusion criteria by number.' },
    ],
  },
  sectionRules: {
    s6_2: [
      { severity: 'must'   as const, text: 'Must list GCP-ineligible populations explicitly.' },
      { severity: 'should' as const, text: 'Should describe the washout period.' },
    ],
  },
} satisfies ApiPolicy & WorkerPolicy

describe('renderPolicyPromptBlock — API ↔ worker parity', () => {
  it('produces identical output for a representative policy (no section context)', () => {
    expect(workerRender(SAMPLE_POLICY)).toBe(apiRender(SAMPLE_POLICY))
  })

  it('produces identical output when a section key is supplied', () => {
    expect(workerRender(SAMPLE_POLICY, 's6_2')).toBe(apiRender(SAMPLE_POLICY, 's6_2'))
  })

  it('both return the empty string for a null policy', () => {
    expect(apiRender(null)).toBe('')
    expect(workerRender(null)).toBe('')
  })

  it('both include the SME prompt + document-wide principles ordered must → should → nice', () => {
    const out = apiRender(SAMPLE_POLICY)
    expect(out).toContain('SME PROMPT (policy v3)')
    expect(out).toContain('[MUST] Follow ICH M11 structural register throughout.')
    expect(out).toContain('[SHOULD] Methods and Results sections should be concise.')
    expect(out).toContain('[NICE] Prefer active voice.')
    // Order check
    const mustIx   = out.indexOf('[MUST]')
    const shouldIx = out.indexOf('[SHOULD]')
    const niceIx   = out.indexOf('[NICE]')
    expect(mustIx).toBeLessThan(shouldIx)
    expect(shouldIx).toBeLessThan(niceIx)
  })

  it('surfaces section-scoped rules only when a sectionKey is passed', () => {
    const withoutKey = apiRender(SAMPLE_POLICY)
    expect(withoutKey).not.toContain('SECTION RULES')

    const withKey = apiRender(SAMPLE_POLICY, 's6_2')
    expect(withKey).toContain('SECTION RULES (s6_2)')
    expect(withKey).toContain('[MUST] Numbered list, one inclusion criterion per line.')
    expect(withKey).toContain('[MUST] Must list GCP-ineligible populations explicitly.')
    expect(withKey).toContain('[SHOULD] Cross-reference exclusion criteria by number.')
    expect(withKey).toContain('[SHOULD] Should describe the washout period.')
  })
})
