import { describe, expect, it } from 'vitest'
import { eventForTarget, transition, type UserEvent, type UserStatus } from './status-machine.js'

const STATUSES: UserStatus[] = ['invited', 'active', 'suspended', 'deprovisioned']
const EVENTS: UserEvent[] = ['accept', 'suspend', 'reactivate', 'deprovision']

const ALLOWED: Array<[UserStatus, UserEvent, UserStatus]> = [
  ['invited', 'accept', 'active'],
  ['invited', 'deprovision', 'deprovisioned'],
  ['active', 'suspend', 'suspended'],
  ['active', 'deprovision', 'deprovisioned'],
  ['suspended', 'reactivate', 'active'],
  ['suspended', 'deprovision', 'deprovisioned'],
]

describe('user status machine', () => {
  it.each(ALLOWED)('%s --%s--> %s', (from, event, to) => {
    expect(transition(from, event)).toMatchObject({ ok: true, to })
  })

  it('rejects every pair not in the allowed table', () => {
    for (const from of STATUSES) {
      for (const event of EVENTS) {
        const allowed = ALLOWED.some(([f, e]) => f === from && e === event)
        expect(transition(from, event).ok).toBe(allowed)
      }
    }
  })

  it('deprovisioned is terminal', () => {
    for (const event of EVENTS) expect(transition('deprovisioned', event).ok).toBe(false)
  })

  it('an invitee cannot be reactivated, only accept', () => {
    expect(transition('invited', 'reactivate').ok).toBe(false)
  })
})

describe('eventForTarget', () => {
  it('maps status targets to events', () => {
    expect(eventForTarget('active', 'suspended')).toBe('suspend')
    expect(eventForTarget('suspended', 'active')).toBe('reactivate')
    expect(eventForTarget('suspended', 'deprovisioned')).toBe('deprovision')
  })
  it('never yields accept (invitation flow only)', () => {
    expect(eventForTarget('invited', 'active')).toBeNull()
  })
  it('returns null for no-ops and illegal targets', () => {
    expect(eventForTarget('active', 'active')).toBeNull()
    expect(eventForTarget('deprovisioned', 'active')).toBeNull()
  })
})
