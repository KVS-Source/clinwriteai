import { describe, expect, it } from 'vitest'
import { evaluateSubmitGate, type ChecklistItemForGate } from './submit-gate.js'

function item(overrides: Partial<ChecklistItemForGate>): ChecklistItemForGate {
  return {
    id: 'i-' + Math.random().toString(36).slice(2, 8),
    text: 'An item',
    framework: 'ICH E3',
    frameworkMandatory: false,
    status: 'pending',
    stage: 'in_authoring',
    ...overrides,
  }
}

describe('evaluateSubmitGate', () => {
  it('returns clean when every item is complete', () => {
    const r = evaluateSubmitGate([
      item({ status: 'complete', frameworkMandatory: true }),
      item({ status: 'complete', frameworkMandatory: false }),
    ])
    expect(r.kind).toBe('clean')
  })

  it('returns clean when pending items are all waived', () => {
    const r = evaluateSubmitGate([
      item({ status: 'waived', frameworkMandatory: true }),
      item({ status: 'waived', frameworkMandatory: false }),
    ])
    expect(r.kind).toBe('clean')
  })

  it('returns clean for an empty checklist', () => {
    const r = evaluateSubmitGate([])
    expect(r.kind).toBe('clean')
  })

  it('BLOCKS when any mandatory item is pending', () => {
    const r = evaluateSubmitGate([
      item({ status: 'pending', frameworkMandatory: true, text: 'Primary endpoint stated' }),
      item({ status: 'complete', frameworkMandatory: true }),
    ])
    expect(r.kind).toBe('block')
    if (r.kind === 'block') {
      expect(r.pendingMandatory).toHaveLength(1)
      expect(r.pendingMandatory[0].text).toBe('Primary endpoint stated')
      expect(r.pendingOptional).toHaveLength(0)
    }
  })

  it('BLOCK takes precedence over warn when both mandatory and optional are pending', () => {
    const r = evaluateSubmitGate([
      item({ status: 'pending', frameworkMandatory: true }),
      item({ status: 'pending', frameworkMandatory: false }),
      item({ status: 'pending', frameworkMandatory: false }),
    ])
    expect(r.kind).toBe('block')
    if (r.kind === 'block') {
      expect(r.pendingMandatory).toHaveLength(1)
      expect(r.pendingOptional).toHaveLength(2)
    }
  })

  it('WARNS when only optional items are pending', () => {
    const r = evaluateSubmitGate([
      item({ status: 'pending', frameworkMandatory: false, text: 'Add author bio' }),
      item({ status: 'complete', frameworkMandatory: true }),
    ])
    expect(r.kind).toBe('warn')
    if (r.kind === 'warn') {
      expect(r.pendingOptional).toHaveLength(1)
      expect(r.pendingOptional[0].text).toBe('Add author bio')
    }
  })

  it('mixed terminal statuses + one pending mandatory still blocks', () => {
    const r = evaluateSubmitGate([
      item({ status: 'complete', frameworkMandatory: true }),
      item({ status: 'waived',   frameworkMandatory: true }),
      item({ status: 'pending',  frameworkMandatory: true, text: 'The one that matters' }),
    ])
    expect(r.kind).toBe('block')
    if (r.kind === 'block') {
      expect(r.pendingMandatory.map(i => i.text)).toEqual(['The one that matters'])
    }
  })
})
