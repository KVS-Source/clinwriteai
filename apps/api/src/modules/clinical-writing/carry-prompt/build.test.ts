// Unit tests for buildCarryPrompt — pure function, no DB, no clock.
//
// Covers the invariants downstream code will key off:
//   - System prompt contains all four escape-hatch tokens by name.
//   - System prompt names the next Vancouver number source.
//   - Role phrasing switches on brief.document.type.
//   - Jurisdictions render comma-separated; empty list surfaces a warning.
//   - User prompt order is <brief>, <section>, <sources>, <ask>.
//   - Empty section content renders a placeholder so the model doesn't get
//     an ambiguous blank.
//   - Source excerpts render numbered; empty list renders a "none" line.
//
// The exact prompt wording is NOT snapshotted — we assert on content
// contracts instead, so copy edits to one line don't fail every test.

import { describe, expect, it } from 'vitest'
import { generateBrief } from '../document-brief/generate.js'
import type { DocumentBrief } from '../document-brief/schema.js'
import {
  buildCarryPrompt,
  buildSystemPrompt,
  buildUserPrompt,
} from './build.js'

function briefFixture(over: Partial<Parameters<typeof generateBrief>[0]['document']> = {}): DocumentBrief {
  return generateBrief({
    document: {
      id:                     'doc-1',
      type:                   'protocol',
      title:                  'VELORA Phase III protocol',
      status:                 'in_authoring',
      stage:                  'study_start_up',
      sponsor:                'Acme Pharma',
      templateId:             null,
      regulatoryRegion:       'us',
      studyTitle:             'A Phase III study',
      protocolNumber:         'GB-001',
      protocolVersion:        'v1',
      investigationalProduct: 'Compound X',
      studyDesign:            null,
      targetPopulation:       null,
      ...over,
    },
    sections: [
      { sectionId: 's1',   sectionNumber: '1',   sectionTitle: 'Summary',  ichStatus: 'complete',    wordCount: 300 },
      { sectionId: 's6_2', sectionNumber: '6.2', sectionTitle: 'Criteria', ichStatus: 'in_progress', wordCount: 150 },
    ],
    sources:     [{ uploadId: 'up-1', title: 'IB v2.3', category: 'ib' }],
    tlfItems:    [{ itemType: 'T', referenceId: 'Table 3', title: 'Demographics' }],
    ichWaivers:  [],
    citedCount:  5,
    rev:         0,
    now:         () => new Date('2026-11-07T00:00:00Z'),
  })
}

const section = {
  sectionId:     's6_2',
  sectionNumber: '6.2',
  sectionTitle:  'Eligibility Criteria',
  contentHtml:   '<p>Adults with X.</p>',
}

describe('buildSystemPrompt', () => {
  it('names all four escape-hatch tokens by their exact bracketed form', () => {
    const sp = buildSystemPrompt(briefFixture())
    expect(sp).toMatch(/\[Information Required: /)
    expect(sp).toMatch(/\[Conflict: /)
    expect(sp).toMatch(/\[Reference Verification Required: /)
    expect(sp).toMatch(/\[Missing Cross-Ref Target: /)
  })

  it('points the model at brief.references.nextNumber for new citations', () => {
    const sp = buildSystemPrompt(briefFixture())
    expect(sp).toContain('brief.references.nextNumber')
  })

  it('uses the protocol role phrasing when doc type is protocol', () => {
    const sp = buildSystemPrompt(briefFixture({ type: 'protocol' }))
    expect(sp).toMatch(/clinical trial protocol/i)
    expect(sp).toMatch(/ICH M11/i)
  })

  it('switches role for protocol-amendment', () => {
    const sp = buildSystemPrompt(briefFixture({ type: 'protocol-amendment' }))
    expect(sp).toMatch(/protocol amendment/i)
  })

  it('falls back to a generic role for unknown doc types', () => {
    const sp = buildSystemPrompt(briefFixture({ type: 'csr_full' }))
    // 'csr_full' hyphenates to 'csr-full', which renders as 'csr full' in the role line
    expect(sp).toMatch(/csr full/i)
  })

  it('renders jurisdictions as a comma-separated list when present', () => {
    const sp = buildSystemPrompt(briefFixture({ regulatoryRegion: 'global' }))
    expect(sp).toContain('FDA, EMA, CDSCO')
  })

  it('surfaces a flag note when jurisdictions are empty', () => {
    const sp = buildSystemPrompt(briefFixture({ regulatoryRegion: 'other' }))
    expect(sp).toMatch(/none specified/i)
  })

  it('states the draft label verbatim so the model does not drift into approval language', () => {
    const sp = buildSystemPrompt(briefFixture())
    expect(sp).toContain('Draft – Subject to Medical, Statistical, Regulatory, and Quality Review')
  })

  it('carries the sponsor policy knobs through', () => {
    const sp = buildSystemPrompt(briefFixture())
    expect(sp).toContain('Vancouver/ICMJE')
    expect(sp).toContain('superscript a-z')
    expect(sp).toContain('define on first use')
  })
})

describe('buildUserPrompt', () => {
  it('orders blocks brief → section → sources → ask', () => {
    const up = buildUserPrompt({
      brief:    briefFixture(),
      section,
      sources:  [{ title: 'IB', excerpt: 'Dose: 10 mg.' }],
      ask:      'Tighten.',
    })
    const briefIdx   = up.indexOf('<brief>')
    const sectionIdx = up.indexOf('<section')
    const sourcesIdx = up.indexOf('<sources>')
    const askIdx     = up.indexOf('<ask>')
    expect(briefIdx).toBeGreaterThanOrEqual(0)
    expect(sectionIdx).toBeGreaterThan(briefIdx)
    expect(sourcesIdx).toBeGreaterThan(sectionIdx)
    expect(askIdx).toBeGreaterThan(sourcesIdx)
  })

  it('tags the section block with the section id for downstream parsers', () => {
    const up = buildUserPrompt({ brief: briefFixture(), section, ask: 'x' })
    expect(up).toContain(`<section id="s6_2">`)
  })

  it('renders a placeholder when section content is empty', () => {
    const up = buildUserPrompt({
      brief:   briefFixture(),
      section: { ...section, contentHtml: '' },
      ask:     'draft from scratch',
    })
    expect(up).toContain('(section is currently empty)')
  })

  it('numbers source excerpts and labels each with the title', () => {
    const up = buildUserPrompt({
      brief:   briefFixture(),
      section,
      sources: [
        { title: 'IB v2.3',    excerpt: 'A.' },
        { title: 'Protocol v1', excerpt: 'B.' },
      ],
      ask: 'x',
    })
    expect(up).toContain('[1] IB v2.3')
    expect(up).toContain('[2] Protocol v1')
  })

  it('renders a "none" placeholder when sources is empty / absent', () => {
    const up = buildUserPrompt({ brief: briefFixture(), section, ask: 'x' })
    expect(up).toContain('(no source excerpts supplied for this turn)')
  })

  it('trims the ask (strips leading/trailing whitespace)', () => {
    const up = buildUserPrompt({ brief: briefFixture(), section, ask: '   Tighten.   \n' })
    expect(up).toMatch(/<ask>\nTighten\.\n<\/ask>/)
  })

  it('serialises the brief as JSON inside the <brief> block', () => {
    const up = buildUserPrompt({ brief: briefFixture(), section, ask: 'x' })
    const match = /<brief>\n([\s\S]*?)\n<\/brief>/.exec(up)
    expect(match).not.toBeNull()
    const parsed = JSON.parse(match![1]!) as DocumentBrief
    expect(parsed.document.id).toBe('doc-1')
    expect(parsed.references.nextNumber).toBe(6)                    // citedCount=5 + 1
  })
})

describe('buildCarryPrompt', () => {
  it('returns both halves ready for the gateway', () => {
    const r = buildCarryPrompt({ brief: briefFixture(), section, ask: 'x' })
    expect(r.systemPrompt).toContain('ROLE')
    expect(r.userPrompt).toContain('<ask>')
  })
})
