import { describe, it, expect, beforeEach } from 'vitest'
import { encryptColumn, decryptColumn, _resetKeyCache } from './column-crypto.js'

describe('column-crypto', () => {
  beforeEach(() => {
    delete process.env.COLUMN_ENC_KEY
    _resetKeyCache()
  })

  it('round-trips plaintext through encrypt → decrypt', () => {
    const original = '+91 98765 43210'
    const ct = encryptColumn(original)
    expect(ct).not.toBeNull()
    expect(ct).toMatch(/^v1:/)
    expect(decryptColumn(ct)).toBe(original)
  })

  it('returns null for null input', () => {
    expect(encryptColumn(null)).toBeNull()
    expect(decryptColumn(null)).toBeNull()
  })

  it('produces different ciphertext for same input (IV randomised)', () => {
    const a = encryptColumn('hello')
    const b = encryptColumn('hello')
    expect(a).not.toBe(b)   // IV randomness
    expect(decryptColumn(a)).toBe('hello')
    expect(decryptColumn(b)).toBe('hello')
  })

  it('passes through legacy plaintext (no version prefix)', () => {
    expect(decryptColumn('legacy-plaintext-value')).toBe('legacy-plaintext-value')
  })

  it('throws on tampered ciphertext', () => {
    const ct = encryptColumn('secret')!
    // Flip a byte in the auth tag portion.
    const parts = ct.split(':')
    parts[2] = parts[2].split('').reverse().join('')
    const tampered = parts.join(':')
    expect(() => decryptColumn(tampered)).toThrow()
  })

  it('refuses to boot without a key in production', () => {
    process.env.NODE_ENV = 'production'
    _resetKeyCache()
    try {
      expect(() => encryptColumn('anything')).toThrow(/COLUMN_ENC_KEY/)
    } finally {
      process.env.NODE_ENV = 'test'
      _resetKeyCache()
    }
  })
})
