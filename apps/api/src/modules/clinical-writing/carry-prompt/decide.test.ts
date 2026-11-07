// Unit tests for carryPromptEnabledFor / parseCarryPromptAllowlist.

import { describe, expect, it } from 'vitest'
import { carryPromptEnabledFor, parseCarryPromptAllowlist } from './decide.js'

describe('parseCarryPromptAllowlist', () => {
  it('returns an empty set when the env var is empty / missing', () => {
    expect(parseCarryPromptAllowlist(undefined).size).toBe(0)
    expect(parseCarryPromptAllowlist(null).size).toBe(0)
    expect(parseCarryPromptAllowlist('').size).toBe(0)
    expect(parseCarryPromptAllowlist('   ').size).toBe(0)
  })

  it('splits on commas and trims whitespace', () => {
    const s = parseCarryPromptAllowlist(' protocol , protocol-amendment ')
    expect(s.has('protocol')).toBe(true)
    expect(s.has('protocol-amendment')).toBe(true)
    expect(s.size).toBe(2)
  })

  it('lowercases entries so casing in the env does not matter', () => {
    const s = parseCarryPromptAllowlist('Protocol,PROTOCOL-AMENDMENT')
    expect(s.has('protocol')).toBe(true)
    expect(s.has('protocol-amendment')).toBe(true)
  })

  it('drops empty entries between commas', () => {
    expect(parseCarryPromptAllowlist('protocol,,,ib').size).toBe(2)
  })
})

describe('carryPromptEnabledFor', () => {
  it('returns false when no env var is set', () => {
    expect(carryPromptEnabledFor('protocol', {})).toBe(false)
  })

  it('returns true only for doc types in the allowlist', () => {
    const env = { FEATURE_CARRY_PROMPT: 'protocol,protocol-amendment' }
    expect(carryPromptEnabledFor('protocol', env)).toBe(true)
    expect(carryPromptEnabledFor('protocol-amendment', env)).toBe(true)
    expect(carryPromptEnabledFor('csr-full', env)).toBe(false)
  })

  it('matches case-insensitively', () => {
    const env = { FEATURE_CARRY_PROMPT: 'protocol' }
    expect(carryPromptEnabledFor('PROTOCOL', env)).toBe(true)
  })
})
