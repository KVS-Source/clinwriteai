// project.update audit details (FR-A-061): old → new for every field the
// request actually changed, as JSON-plain values the audit hash can rely on.

import { describe, expect, it } from 'vitest'
import { projectChanges } from './routes.js'

const before = {
  name: 'Test', phase: 'Phase 1/2', status: 'initiated', therapeuticArea: 'Oncology',
  dataCutoff: null, startDate: new Date('2026-10-27T00:00:00.000Z'), sponsor: 'Acme',
}

describe('projectChanges', () => {
  it('records from/to for each changed field, including dates and nulls', () => {
    const after = { ...before, phase: 'Phase III', dataCutoff: new Date('2026-12-31T00:00:00.000Z') }
    expect(projectChanges(before, after, ['phase', 'dataCutoff'])).toEqual({
      phase:      { from: 'Phase 1/2', to: 'Phase III' },
      dataCutoff: { from: null, to: '2026-12-31T00:00:00.000Z' },
    })
  })

  it('leaves out submitted fields whose value did not change', () => {
    const after = { ...before, name: 'Test', sponsor: 'Acme 2' }
    expect(projectChanges(before, after, ['name', 'sponsor'])).toEqual({
      sponsor: { from: 'Acme', to: 'Acme 2' },
    })
  })

  it('compares dates by value, not by object identity', () => {
    const after = { ...before, startDate: new Date('2026-10-27T00:00:00.000Z') }
    expect(projectChanges(before, after, ['startDate'])).toEqual({})
  })

  it('produces JSON-plain values (survive a JSONB round-trip unchanged)', () => {
    const after = { ...before, therapeuticArea: 'Cardiovascular', dataCutoff: new Date('2027-01-15T00:00:00.000Z') }
    const changes = projectChanges(before, after, ['therapeuticArea', 'dataCutoff'])
    expect(JSON.parse(JSON.stringify(changes))).toEqual(changes)
  })
})
