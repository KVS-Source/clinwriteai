// renderPolicyPromptBlock must produce identical output on the API side
// (/ai-suggest) and the worker side (initial-draft). They sit in two
// independent packages; the worker file is imported directly here so
// drift between them fails CI, not production.

import { describe, expect, it } from 'vitest'
import {
  renderPolicyPromptBlock as apiRender,
  renderSectionTemplateNL as apiRenderTemplate,
  SECTION_GROUNDING_RULES as API_GROUNDING,
  type PolicyRowForAi as ApiPolicy,
} from './resolve.js'
import {
  renderPolicyPromptBlock as workerRender,
  renderSectionTemplateNL as workerRenderTemplate,
  SECTION_GROUNDING_RULES as WORKER_GROUNDING,
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
  // Empty — exercise the legacy SME-prompt-dump fallback. The GENERAL
  // RULES branch is covered by its own describe block below.
  crossCuttingRules: [],
} satisfies ApiPolicy & WorkerPolicy

const SAMPLE_POLICY_WITH_CROSS = {
  ...SAMPLE_POLICY,
  crossCuttingRules: [
    { severity: 'must'   as const, text: 'Write in active voice throughout.' },
    { severity: 'must'   as const, text: 'Never invent numeric values, patient counts, or citations.' },
    { severity: 'should' as const, text: 'Prefer British English spelling.' },
  ],
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

  it('includes the SME prompt + does NOT include BP digest principles (removed Nov 2026)', () => {
    const out = apiRender(SAMPLE_POLICY)
    expect(out).toContain('SME PROMPT (policy v3)')
    // BP was retired as an AI-steering input — it's author-facing
    // guidance now, not prompt content. Neither the DOCUMENT-WIDE
    // PRINCIPLES block nor any `whole-doc` BP principles should flow
    // into the composed prompt.
    expect(out).not.toContain('DOCUMENT-WIDE PRINCIPLES')
    expect(out).not.toContain('Follow ICH M11 structural register throughout.')
    expect(out).not.toContain('Prefer active voice.')
    expect(out).not.toContain('Methods and Results sections should be concise.')
  })

  it('SECTION_GROUNDING_RULES is character-identical on API + worker', () => {
    expect(WORKER_GROUNDING).toBe(API_GROUNDING)
    // Sanity: the constant carries the four guardrails callers rely on.
    expect(API_GROUNDING).toMatch(/SECTION GROUNDING RULES/)
    expect(API_GROUNDING).toMatch(/authoritative primary references/)
    expect(API_GROUNDING).toMatch(/\[TBD: what is needed\]/)
    expect(API_GROUNDING).toMatch(/single section only/)
    expect(API_GROUNDING).toMatch(/reference markers/)
  })

  it('surfaces explicit section_rules only (no BP-scoped section principles)', () => {
    const withoutKey = apiRender(SAMPLE_POLICY)
    expect(withoutKey).not.toContain('SECTION RULES')

    const withKey = apiRender(SAMPLE_POLICY, 's6_2')
    expect(withKey).toContain('SECTION RULES (s6_2)')
    // Explicit `policy.sectionRules[s6_2]` entries DO flow into the
    // prompt — those are author-curated rules, not BP-derived.
    expect(withKey).toContain('[MUST] Must list GCP-ineligible populations explicitly.')
    expect(withKey).toContain('[SHOULD] Should describe the washout period.')
    // BP-scoped section principles (scope: 'section:s6_2') are now
    // suppressed since BP was retired as an AI steering input.
    expect(withKey).not.toContain('Numbered list, one inclusion criterion per line.')
    expect(withKey).not.toContain('Cross-reference exclusion criteria by number.')
  })
})

describe('renderPolicyPromptBlock — GENERAL RULES path (migration 95)', () => {
  it('emits GENERAL RULES in place of the verbatim SME PROMPT when crossCuttingRules is non-empty', () => {
    const out = apiRender(SAMPLE_POLICY_WITH_CROSS)
    expect(out).toContain('GENERAL RULES (policy v3) — apply to every section')
    expect(out).toContain('[MUST] Write in active voice throughout.')
    expect(out).toContain('[MUST] Never invent numeric values, patient counts, or citations.')
    expect(out).toContain('[SHOULD] Prefer British English spelling.')
    // SME prompt verbatim must NOT appear — that was the whole point.
    expect(out).not.toContain('You are a Clinical Protocol subject-matter expert.')
    expect(out).not.toContain('SME PROMPT')
  })

  it('falls back to the verbatim SME prompt when crossCuttingRules is empty (legacy row)', () => {
    const out = apiRender(SAMPLE_POLICY)
    expect(out).toContain('SME PROMPT (policy v3)')
    expect(out).toContain('You are a Clinical Protocol subject-matter expert.')
    expect(out).not.toContain('GENERAL RULES')
  })

  it('API ↔ worker parity: both emit identical GENERAL RULES output', () => {
    expect(workerRender(SAMPLE_POLICY_WITH_CROSS)).toBe(apiRender(SAMPLE_POLICY_WITH_CROSS))
    expect(workerRender(SAMPLE_POLICY_WITH_CROSS, 's6_2')).toBe(apiRender(SAMPLE_POLICY_WITH_CROSS, 's6_2'))
  })

  it('cross-cutting rules sort must → should → nice regardless of input order', () => {
    const scrambled = {
      ...SAMPLE_POLICY,
      crossCuttingRules: [
        { severity: 'nice'   as const, text: 'Use the Oxford comma.' },
        { severity: 'should' as const, text: 'Prefer British English.' },
        { severity: 'must'   as const, text: 'Write in active voice.' },
      ],
    } satisfies ApiPolicy
    const out = apiRender(scrambled)
    const mustIdx   = out.indexOf('[MUST] Write in active voice.')
    const shouldIdx = out.indexOf('[SHOULD] Prefer British English.')
    const niceIdx   = out.indexOf('[NICE] Use the Oxford comma.')
    expect(mustIdx).toBeGreaterThan(-1)
    expect(shouldIdx).toBeGreaterThan(mustIdx)
    expect(niceIdx).toBeGreaterThan(shouldIdx)
  })
})

describe('renderSectionTemplateNL — API ↔ worker parity (migration 91: NL rules)', () => {
  // Representative NL rules — same shape an admin would author in the UI.
  const RULES = [
    'Font: Times New Roman, 11pt, black.',
    'Paragraphs: justified alignment, 1.15 line height, 6pt space after.',
    'Lists: numbered ("1."), one item per line.',
    'Tables: 0.5pt solid black borders, gray (#E7E6E6) bold header row, 4pt cell padding.',
    'References: superscript style.',
  ].join('\n')

  it('wraps the rules with the headline + returns character-identical output on API ↔ worker', () => {
    const out = apiRenderTemplate(RULES, 's6_2')
    expect(out).toBe(workerRenderTemplate(RULES, 's6_2'))
    expect(out).toContain('SECTION TEMPLATE (s6_2) — follow these formatting rules')
    // Rules pass through verbatim — no translation, no reformatting.
    expect(out).toContain('Font: Times New Roman, 11pt, black.')
    expect(out).toContain('References: superscript style.')
  })

  it('returns "" for empty / whitespace-only rules', () => {
    expect(apiRenderTemplate('', 's6_2')).toBe('')
    expect(workerRenderTemplate('   \n  \t\n', 's6_2')).toBe('')
  })

  it('trims surrounding whitespace so the block body is clean', () => {
    const out = apiRenderTemplate('\n\n  Font: Arial 10pt.  \n\n', 'methods')
    expect(out).toBe('SECTION TEMPLATE (methods) — follow these formatting rules\nFont: Arial 10pt.')
    expect(workerRenderTemplate('\n\n  Font: Arial 10pt.  \n\n', 'methods')).toBe(out)
  })

  it('splices SECTION TEMPLATE into renderPolicyPromptBlock after SECTION RULES', () => {
    const policy = SAMPLE_POLICY satisfies ApiPolicy
    const out = apiRender(policy, 's6_2', RULES)
    const ruleIdx = out.indexOf('SECTION RULES (s6_2)')
    const tplIdx  = out.indexOf('SECTION TEMPLATE (s6_2)')
    expect(ruleIdx).toBeGreaterThan(-1)
    expect(tplIdx).toBeGreaterThan(ruleIdx)
    // Worker parity on the composed output.
    expect(workerRender(policy, 's6_2', RULES))
      .toBe(apiRender(policy, 's6_2', RULES))
  })
})
