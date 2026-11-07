// Unit tests for generateBrief() — pure function, no DB.
//
// Covers the invariants the AI carry prompt relies on:
//   - Protocol block populated only for protocol / protocol-amendment.
//   - jurisdictions expanded from regulatoryRegion.
//   - nextNumber === citedCount + 1.
//   - type/status/stage hyphenated.
//   - TlfItem split by itemType into tables/figures/listings.
//   - Deterministic generatedAt via injected `now`.

import { describe, expect, it } from 'vitest'
import { generateBrief, type GenerateBriefInputs } from './generate.js'
import { DRAFT_LABEL } from './schema.js'

const FROZEN_NOW = () => new Date('2026-11-06T12:00:00Z')

function baseInputs(over: Partial<GenerateBriefInputs> = {}): GenerateBriefInputs {
  return {
    document: {
      id:                     'doc-1',
      type:                   'protocol',
      title:                  'VELORA Phase III protocol',
      status:                 'in_authoring',
      stage:                  'study_start_up',
      sponsor:                'Acme Pharma',
      templateId:             null,
      regulatoryRegion:       'us',
      studyTitle:             'A Phase III study of X in Y',
      protocolNumber:         'GB-NSCLC-002',
      protocolVersion:        'v3.1',
      investigationalProduct: 'Compound X',
      studyDesign:            'Randomised double-blind',
      targetPopulation:       'Adults with Y',
    },
    sections: [
      { sectionId: 's1',   sectionNumber: '1',   sectionTitle: 'Protocol Summary',    ichStatus: 'complete',    wordCount: 320 },
      { sectionId: 's6_2', sectionNumber: '6.2', sectionTitle: 'Eligibility Criteria', ichStatus: 'in_progress', wordCount: 180 },
    ],
    sources: [
      { uploadId: 'up-1', title: 'IB v2.3', category: 'ib' },
    ],
    tlfItems: [
      { itemType: 'T', referenceId: 'Table 14.2.1', title: 'Demographics' },
      { itemType: 'F', referenceId: 'Figure 1',     title: 'Study schema' },
      { itemType: 'L', referenceId: 'Listing 16.2.1', title: 'AE listing' },
    ],
    ichWaivers: [
      { sectionCode: '§16.4', reason: 'Non-US submission' },
    ],
    citedCount: 7,
    rev:        0,
    now:        FROZEN_NOW,
    ...over,
  }
}

describe('generateBrief', () => {
  it('produces a protocol brief with jurisdictions, inventory split, and nextNumber = citedCount + 1', () => {
    const b = generateBrief(baseInputs())

    expect(b.rev).toBe(0)
    expect(b.document.type).toBe('protocol')
    expect(b.document.draftLabel).toBe(DRAFT_LABEL)
    expect(b.document.jurisdictions).toEqual(['FDA'])
    expect(b.document.guidelineVersions).toMatchObject({ M11: '2024', E6: 'R3-2025' })

    expect(b.protocol).toBeDefined()
    expect(b.protocol?.protocolNumber).toBe('GB-NSCLC-002')

    expect(b.outline).toHaveLength(2)
    expect(b.outline[0]).toMatchObject({ number: '1', title: 'Protocol Summary', status: 'complete' })
    expect(b.outline[1]?.status).toBe('in-progress')  // hyphenated

    expect(b.inventory.tables).toEqual([{ ref: 'Table 14.2.1', title: 'Demographics' }])
    expect(b.inventory.figures).toEqual([{ ref: 'Figure 1',     title: 'Study schema' }])
    expect(b.inventory.listings).toEqual([{ ref: 'Listing 16.2.1', title: 'AE listing' }])
    expect(b.inventory.appendices).toEqual([])

    expect(b.references.citedCount).toBe(7)
    expect(b.references.nextNumber).toBe(8)
    expect(b.references.sources).toEqual([{ uploadId: 'up-1', title: 'IB v2.3', category: 'ib' }])

    expect(b.openFlags.ichWaivers).toEqual([{ sectionCode: '§16.4', reason: 'Non-US submission' }])
    expect(b.openFlags.informationRequired).toEqual([])
    expect(b.openFlags.conflicts).toEqual([])
    expect(b.openFlags.referenceVerification).toEqual([])

    expect(b.generatedAt).toBe('2026-11-06T12:00:00.000Z')
  })

  it('omits the protocol block for non-protocol doc types', () => {
    const b = generateBrief(baseInputs({
      document: { ...baseInputs().document, type: 'csr_full' },
    }))
    expect(b.document.type).toBe('csr-full')           // hyphenated at the edge
    expect(b.protocol).toBeUndefined()
  })

  it('includes the protocol block for protocol-amendment', () => {
    const b = generateBrief(baseInputs({
      document: { ...baseInputs().document, type: 'protocol-amendment' },
    }))
    expect(b.protocol).toBeDefined()
  })

  it('expands regulatoryRegion = global to the tri-authority list', () => {
    const b = generateBrief(baseInputs({
      document: { ...baseInputs().document, regulatoryRegion: 'global' },
    }))
    expect(b.document.jurisdictions).toEqual(['FDA', 'EMA', 'CDSCO'])
  })

  it('leaves jurisdictions empty when region is other / null / unknown', () => {
    for (const region of ['other', null, 'mars']) {
      const b = generateBrief(baseInputs({
        document: { ...baseInputs().document, regulatoryRegion: region },
      }))
      expect(b.document.jurisdictions).toEqual([])
    }
  })

  it('sets nextNumber = 1 when there are no cited references yet', () => {
    const b = generateBrief(baseInputs({ citedCount: 0 }))
    expect(b.references.nextNumber).toBe(1)
  })

  it('carries the provided rev through verbatim', () => {
    const b = generateBrief(baseInputs({ rev: 5 }))
    expect(b.rev).toBe(5)
  })

  it('hyphenates status and stage', () => {
    const b = generateBrief(baseInputs({
      document: {
        ...baseInputs().document,
        status: 'pending_signature',
        stage:  'cross_functional_review',
      },
    }))
    expect(b.document.status).toBe('pending-signature')
    expect(b.document.stage).toBe('cross-functional-review')
  })
})
