import { describe, expect, it } from 'vitest'
import { canTransition, nextStates, InvalidTransitionError } from './state-machine.js'

describe('project state machine', () => {
  it('permits the common forward flow', () => {
    expect(canTransition('initiated', 'ongoing')).toBe(true)
    expect(canTransition('ongoing', 'on-hold')).toBe(true)
    expect(canTransition('on-hold', 'ongoing')).toBe(true)
    expect(canTransition('ongoing', 'closed')).toBe(true)
  })

  it('refuses no-op self-transitions', () => {
    expect(canTransition('ongoing', 'ongoing')).toBe(false)
    expect(canTransition('closed', 'closed')).toBe(false)
  })

  it('refuses skipping back to earlier states except via re-open', () => {
    expect(canTransition('ongoing', 'initiated')).toBe(false)
    expect(canTransition('closed', 'ongoing')).toBe(false)
    expect(canTransition('closed', 're-open')).toBe(true)
    expect(canTransition('re-open', 'ongoing')).toBe(true)
  })

  it('exposes next states as a hint for the UI', () => {
    expect(nextStates('initiated')).toEqual(['ongoing', 'on-hold', 'closed'])
    expect(nextStates('closed')).toEqual(['re-open'])
  })

  it('InvalidTransitionError carries a human-readable message', () => {
    const err = new InvalidTransitionError('closed', 'ongoing')
    expect(err.message).toMatch(/closed → ongoing/)
    expect(err.message).toMatch(/re-open/)
  })
})
