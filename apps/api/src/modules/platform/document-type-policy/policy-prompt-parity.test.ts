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
import type { SectionTemplateFormat } from '../section-template/schema.js'

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

describe('renderSectionTemplateNL — API ↔ worker parity', () => {
  // Representative format JSON touching every top-level axis so drift
  // in any single branch of the renderer fails the test.
  const FULL_FORMAT: SectionTemplateFormat = {
    page: {
      size: 'A4', orientation: 'portrait', columns: 1,
      margins: { top: 72, right: 54, bottom: 72, left: 54 },
      header:  { enabled: true,  text: 'Study XYZ — Protocol v2.1' },
      footer:  { enabled: true,  pageNumber: true },
    },
    font:      { family: 'Times New Roman', size: 11, color: '#000000', weight: 'normal' },
    paragraph: { alignment: 'justify', lineHeight: 1.15, spaceAfter: 6 },
    heading:   { level: 2, font: { size: 13, weight: 'bold', color: '#003366' }, spaceAfter: 6, numbering: { format: '%1.%2' } },
    list:      { type: 'numbered', marker: '1.' },
    table: {
      borderStyle: 'solid', borderWidth: 0.5, borderColor: '#000000',
      headerRow:   { fill: '#E7E6E6', fontWeight: 'bold' },
      cellPadding: 4,
    },
    references: { style: 'superscript' },
    numbering:  { sections: true, format: '%1.%2', startAt: 6 },
  }

  it('renders character-identical output on API + worker (full format)', () => {
    expect(workerRenderTemplate(FULL_FORMAT, 's6_2'))
      .toBe(apiRenderTemplate(FULL_FORMAT, 's6_2'))
  })

  it('renders character-identical output for a minimal format (font only)', () => {
    const minimal: SectionTemplateFormat = { font: { family: 'Arial', size: 10 } }
    expect(workerRenderTemplate(minimal, 'methods'))
      .toBe(apiRenderTemplate(minimal, 'methods'))
  })

  it('both return "" when the format has nothing renderable', () => {
    expect(apiRenderTemplate({}, 's6_2')).toBe('')
    expect(workerRenderTemplate({}, 's6_2')).toBe('')
  })

  it('includes the headline + font + paragraph + table bits users recognise', () => {
    const out = apiRenderTemplate(FULL_FORMAT, 's6_2')
    expect(out).toContain('SECTION TEMPLATE (s6_2) — follow these formatting rules')
    expect(out).toContain('Times New Roman')
    expect(out).toContain('11pt')
    expect(out).toContain('1.15 line-height')
    expect(out).toContain('solid 0.5pt')
    expect(out).toContain('header row fill #E7E6E6')
    expect(out).toContain('superscript style')
  })

  it('splices SECTION TEMPLATE into renderPolicyPromptBlock after SECTION RULES', () => {
    const policy = SAMPLE_POLICY satisfies ApiPolicy
    const out = apiRender(policy, 's6_2', FULL_FORMAT)
    const ruleIdx = out.indexOf('SECTION RULES (s6_2)')
    const tplIdx  = out.indexOf('SECTION TEMPLATE (s6_2)')
    expect(ruleIdx).toBeGreaterThan(-1)
    expect(tplIdx).toBeGreaterThan(ruleIdx)
    // Worker parity on the composed output.
    expect(workerRender(policy, 's6_2', FULL_FORMAT))
      .toBe(apiRender(policy, 's6_2', FULL_FORMAT))
  })
})
