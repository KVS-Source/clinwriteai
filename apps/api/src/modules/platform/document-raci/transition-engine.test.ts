import { describe, expect, it } from 'vitest'
import { evaluateStageTransition, type RaciRowForEval } from './transition-engine.js'

function row(overrides: Partial<RaciRowForEval>): RaciRowForEval {
  return {
    letter: 'R',
    signatureRequired: false,
    submittedAt: null,
    reviewedAt: null,
    approvedAt: null,
    signatureId: null,
    rejectedAt: null,
    removedAt: null,
    ...overrides,
  }
}

describe('evaluateStageTransition — gating letter per status', () => {
  it('in_authoring is gated by R → in_review', () => {
    const r = evaluateStageTransition('in_authoring', [])
    expect(r.gatingLetter).toBe('R')
    expect(r.nextStatus).toBe('in_review')
  })

  it('in_review is gated by C → pending_signature', () => {
    const r = evaluateStageTransition('in_review', [])
    expect(r.gatingLetter).toBe('C')
    expect(r.nextStatus).toBe('pending_signature')
  })

  it('pending_signature is gated by A → signed', () => {
    const r = evaluateStageTransition('pending_signature', [])
    expect(r.gatingLetter).toBe('A')
    expect(r.nextStatus).toBe('signed')
  })

  it('signed is terminal — no gating letter, no next status', () => {
    const r = evaluateStageTransition('signed', [])
    expect(r.gatingLetter).toBeNull()
    expect(r.nextStatus).toBeNull()
    expect(r.cohortComplete).toBe(false)
  })
})

describe('evaluateStageTransition — cohort completion', () => {
  it('empty cohort is never complete (PM must assign someone first)', () => {
    const r = evaluateStageTransition('in_authoring', [])
    expect(r.cohortTotal).toBe(0)
    expect(r.cohortDone).toBe(0)
    expect(r.cohortComplete).toBe(false)
  })

  it('all R rows submitted → cohort complete', () => {
    const rows = [
      row({ letter: 'R', submittedAt: new Date() }),
      row({ letter: 'R', submittedAt: new Date() }),
      row({ letter: 'R', submittedAt: new Date() }),
    ]
    const r = evaluateStageTransition('in_authoring', rows)
    expect(r.cohortTotal).toBe(3)
    expect(r.cohortDone).toBe(3)
    expect(r.cohortComplete).toBe(true)
  })

  it('partial submission → cohort not complete', () => {
    const rows = [
      row({ letter: 'R', submittedAt: new Date() }),
      row({ letter: 'R', submittedAt: null }),
      row({ letter: 'R', submittedAt: new Date() }),
    ]
    const r = evaluateStageTransition('in_authoring', rows)
    expect(r.cohortDone).toBe(2)
    expect(r.cohortTotal).toBe(3)
    expect(r.cohortComplete).toBe(false)
  })

  it('removed rows are excluded from the cohort', () => {
    const rows = [
      row({ letter: 'R', submittedAt: new Date() }),
      row({ letter: 'R', submittedAt: new Date() }),
      row({ letter: 'R', submittedAt: null, removedAt: new Date() }),  // excluded
    ]
    const r = evaluateStageTransition('in_authoring', rows)
    expect(r.cohortTotal).toBe(2)
    expect(r.cohortDone).toBe(2)
    expect(r.cohortComplete).toBe(true)
  })

  it('non-gating letters are ignored', () => {
    const rows = [
      row({ letter: 'R', submittedAt: new Date() }),
      row({ letter: 'C', reviewedAt: new Date() }),  // ignored in in_authoring
      row({ letter: 'I' }),                           // ignored
      row({ letter: 'A', approvedAt: new Date() }),   // ignored
    ]
    const r = evaluateStageTransition('in_authoring', rows)
    expect(r.cohortTotal).toBe(1)
    expect(r.cohortDone).toBe(1)
    expect(r.cohortComplete).toBe(true)
  })
})

describe('evaluateStageTransition — signature requirement', () => {
  it('signature-required row without signatureId is NOT done', () => {
    const rows = [
      row({
        letter: 'A',
        approvedAt: new Date(),
        signatureRequired: true,
        signatureId: null,       // missing
      }),
    ]
    const r = evaluateStageTransition('pending_signature', rows)
    expect(r.cohortDone).toBe(0)
    expect(r.cohortComplete).toBe(false)
  })

  it('signature-required row with signatureId IS done', () => {
    const rows = [
      row({
        letter: 'A',
        approvedAt: new Date(),
        signatureRequired: true,
        signatureId: 'SIG-0001-01',
      }),
    ]
    const r = evaluateStageTransition('pending_signature', rows)
    expect(r.cohortDone).toBe(1)
    expect(r.cohortTotal).toBe(1)
    expect(r.cohortComplete).toBe(true)
  })

  it('mixed signature requirements evaluated per row', () => {
    const rows = [
      row({ letter: 'A', approvedAt: new Date(), signatureRequired: true,  signatureId: 'SIG-1' }),  // done
      row({ letter: 'A', approvedAt: new Date(), signatureRequired: false, signatureId: null }),       // done (no sig needed)
      row({ letter: 'A', approvedAt: new Date(), signatureRequired: true,  signatureId: null }),       // NOT done
    ]
    const r = evaluateStageTransition('pending_signature', rows)
    expect(r.cohortDone).toBe(2)
    expect(r.cohortTotal).toBe(3)
    expect(r.cohortComplete).toBe(false)
  })
})

describe('evaluateStageTransition — rejection blocks the gate', () => {
  it('any rejected row prevents cohortComplete even when others are done', () => {
    const rows = [
      row({ letter: 'A', approvedAt: new Date() }),
      row({ letter: 'A', approvedAt: new Date() }),
      row({ letter: 'A', rejectedAt: new Date(), approvedAt: null }),
    ]
    const r = evaluateStageTransition('pending_signature', rows)
    expect(r.rejectedRows).toBe(1)
    expect(r.cohortComplete).toBe(false)
  })

  it('reports rejected rows count independently of done count', () => {
    const rows = [
      row({ letter: 'C', reviewedAt: new Date() }),
      row({ letter: 'C', rejectedAt: new Date() }),
      row({ letter: 'C', rejectedAt: new Date() }),
    ]
    const r = evaluateStageTransition('in_review', rows)
    expect(r.rejectedRows).toBe(2)
    expect(r.cohortDone).toBe(1)
    expect(r.cohortComplete).toBe(false)
  })
})
