import { describe, expect, it } from 'vitest'
import { emptySignalContext, evaluateSignal, type SignalContext } from './signal-strategies.js'

function ctx(overrides: Partial<SignalContext>): SignalContext {
  return { ...emptySignalContext(), ...overrides }
}

describe('evaluateSignal — tlf-validated', () => {
  it('completed when tlfPackageValidated is true', () => {
    const r = evaluateSignal(['tlf-validated'], ctx({ tlfPackageValidated: true }))
    expect(r.kind).toBe('completed')
  })

  it('pending when no current TLF package', () => {
    const r = evaluateSignal(['tlf-validated'], ctx({ tlfPackageValidated: false }))
    expect(r.kind).toBe('pending')
    if (r.kind === 'pending') expect(r.reason).toContain('no current TlfPackage')
  })
})

describe('evaluateSignal — esig-captured', () => {
  it('completed when any signature exists (no meaning filter)', () => {
    const r = evaluateSignal(['esig-captured'], ctx({ signatureMeanings: ['approved'] }))
    expect(r.kind).toBe('completed')
    if (r.kind === 'completed') expect(r.reason).toContain('1 signatures')
  })

  it('pending when no signatures exist', () => {
    const r = evaluateSignal(['esig-captured'], ctx({ signatureMeanings: [] }))
    expect(r.kind).toBe('pending')
  })

  it('completed when the required meaning is present', () => {
    const r = evaluateSignal(['esig-captured', 'Medical approval'], ctx({ signatureMeanings: ['medical approval', 'author attestation'] }))
    expect(r.kind).toBe('completed')
    if (r.kind === 'completed') expect(r.reason).toContain('medical approval')
  })

  it('pending when the required meaning is NOT present', () => {
    const r = evaluateSignal(['esig-captured', 'Final signatory'], ctx({ signatureMeanings: ['author attestation'] }))
    expect(r.kind).toBe('pending')
    if (r.kind === 'pending') expect(r.reason).toContain('final signatory')
  })

  it('case-insensitive on the required meaning', () => {
    const r = evaluateSignal(['esig-captured', 'MEDICAL APPROVAL'], ctx({ signatureMeanings: ['medical approval'] }))
    expect(r.kind).toBe('completed')
  })
})

describe('evaluateSignal — crm-resolved', () => {
  it('pending when there are no CRM meetings yet', () => {
    const r = evaluateSignal(['crm-resolved'], ctx({ crmMeetingCount: 0 }))
    expect(r.kind).toBe('pending')
    if (r.kind === 'pending') expect(r.reason).toContain('no CRM meetings')
  })

  it('pending when there are meetings but not all complete', () => {
    const r = evaluateSignal(['crm-resolved'], ctx({ crmMeetingCount: 2, crmMeetingsComplete: false }))
    expect(r.kind).toBe('pending')
    if (r.kind === 'pending') expect(r.reason).toContain('not all CRM')
  })

  it('completed when all meetings are complete', () => {
    const r = evaluateSignal(['crm-resolved'], ctx({ crmMeetingCount: 3, crmMeetingsComplete: true }))
    expect(r.kind).toBe('completed')
    if (r.kind === 'completed') expect(r.reason).toContain('3')
  })
})

describe('evaluateSignal — malformed / unknown', () => {
  it('skipped when signal name is missing', () => {
    const r = evaluateSignal([], ctx({}))
    expect(r.kind).toBe('skipped')
    if (r.kind === 'skipped') expect(r.reason).toContain('missing signal name')
  })

  it('skipped when signal name is unknown', () => {
    const r = evaluateSignal(['does-not-exist'], ctx({}))
    expect(r.kind).toBe('skipped')
    if (r.kind === 'skipped') expect(r.reason).toContain('unknown signal')
  })
})
