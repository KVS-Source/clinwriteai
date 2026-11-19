// Tests for the RS256 JWT verifier. Uses the dev keypair bundled in
// keys.ts so we can sign real tokens in-test without pulling the private
// key from a secret store.

import { describe, expect, it } from 'vitest'
import { createSign, generateKeyPairSync } from 'node:crypto'
import { verifyJwtRS256 } from './jwt-verify.js'
import { DEV_PUBLIC_KEY_PEM, DEV_PRIVATE_KEY_PEM } from './keys.js'

function base64url(buf: Buffer | string): string {
  const b = typeof buf === 'string' ? Buffer.from(buf) : buf
  return b.toString('base64url')
}

function signRS256(payload: Record<string, unknown>, privateKey: string, headerOverrides: Record<string, unknown> = {}): string {
  const header  = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT', ...headerOverrides }))
  const body    = base64url(JSON.stringify(payload))
  const signer  = createSign('sha256')
  signer.update(`${header}.${body}`)
  signer.end()
  const sig     = base64url(signer.sign(privateKey))
  return `${header}.${body}.${sig}`
}

const NOW = Math.floor(Date.now() / 1000)

describe('verifyJwtRS256 — happy path', () => {
  it('accepts a well-formed RS256 token signed by the matching key', () => {
    const token = signRS256({ iss: 'genbioca-licensing', installId: 'x', iat: NOW, exp: NOW + 3600 }, DEV_PRIVATE_KEY_PEM)
    const result = verifyJwtRS256(token, { publicKeyPem: DEV_PUBLIC_KEY_PEM, issuer: 'genbioca-licensing' })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.payload.installId).toBe('x')
      expect(result.payload.iss).toBe('genbioca-licensing')
    }
  })

  it('passes without an issuer check when none is configured', () => {
    const token = signRS256({ iat: NOW, exp: NOW + 3600 }, DEV_PRIVATE_KEY_PEM)
    const result = verifyJwtRS256(token, { publicKeyPem: DEV_PUBLIC_KEY_PEM })
    expect(result.ok).toBe(true)
  })
})

describe('verifyJwtRS256 — rejection cases', () => {
  it('rejects a malformed token (wrong number of parts)', () => {
    const result = verifyJwtRS256('not.a.jwt.extra', { publicKeyPem: DEV_PUBLIC_KEY_PEM })
    expect(result).toEqual({ ok: false, reason: 'malformed', message: expect.any(String) })
  })

  it('rejects alg=none even if signature is empty', () => {
    const header = base64url(JSON.stringify({ alg: 'none', typ: 'JWT' }))
    const body   = base64url(JSON.stringify({ iat: NOW, exp: NOW + 3600 }))
    const token  = `${header}.${body}.`
    const result = verifyJwtRS256(token, { publicKeyPem: DEV_PUBLIC_KEY_PEM })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('unsupported_algorithm')
  })

  it('rejects HS256 tokens even if the HMAC would verify — only RS256 is accepted', () => {
    // RS256 verifier should refuse an HS256 header without attempting any crypto.
    const header = base64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
    const body   = base64url(JSON.stringify({ iat: NOW, exp: NOW + 3600 }))
    const token  = `${header}.${body}.${base64url(Buffer.from('fake'))}`
    const result = verifyJwtRS256(token, { publicKeyPem: DEV_PUBLIC_KEY_PEM })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('unsupported_algorithm')
  })

  it('rejects a token signed by the wrong private key', () => {
    const { privateKey: otherPriv } = generateKeyPairSync('rsa', {
      modulusLength: 2048,
      publicKeyEncoding:  { type: 'spki',  format: 'pem' },
      privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
    })
    const token = signRS256({ iat: NOW, exp: NOW + 3600 }, otherPriv)
    const result = verifyJwtRS256(token, { publicKeyPem: DEV_PUBLIC_KEY_PEM })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('invalid_signature')
  })

  it('rejects an expired token (outside the 60s clock skew window)', () => {
    const token = signRS256({ iat: NOW - 3600, exp: NOW - 120 }, DEV_PRIVATE_KEY_PEM)
    const result = verifyJwtRS256(token, { publicKeyPem: DEV_PUBLIC_KEY_PEM })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('expired')
  })

  it('accepts a token whose exp is within the 60s clock-skew window', () => {
    const token = signRS256({ iat: NOW - 10, exp: NOW - 10 }, DEV_PRIVATE_KEY_PEM)  // "expired" 10s ago
    const result = verifyJwtRS256(token, { publicKeyPem: DEV_PUBLIC_KEY_PEM, now: NOW })
    expect(result.ok).toBe(true)
  })

  it('rejects a not-yet-valid token (nbf in future outside skew)', () => {
    const token = signRS256({ iat: NOW, nbf: NOW + 3600, exp: NOW + 7200 }, DEV_PRIVATE_KEY_PEM)
    const result = verifyJwtRS256(token, { publicKeyPem: DEV_PUBLIC_KEY_PEM })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('not_yet_valid')
  })

  it('rejects on issuer mismatch when expected issuer is set', () => {
    const token = signRS256({ iss: 'someone-else', iat: NOW, exp: NOW + 3600 }, DEV_PRIVATE_KEY_PEM)
    const result = verifyJwtRS256(token, { publicKeyPem: DEV_PUBLIC_KEY_PEM, issuer: 'genbioca-licensing' })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('issuer_mismatch')
  })

  it('rejects a token whose payload was tampered after signing', () => {
    const header  = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
    const original = base64url(JSON.stringify({ iat: NOW, exp: NOW + 3600, modules: ['A'] }))
    const signer  = createSign('sha256'); signer.update(`${header}.${original}`); signer.end()
    const sig     = base64url(signer.sign(DEV_PRIVATE_KEY_PEM))
    // Swap the payload to grant more modules — signature should no longer verify.
    const tampered = base64url(JSON.stringify({ iat: NOW, exp: NOW + 3600, modules: ['A', 'B', 'C', 'D', 'E'] }))
    const token    = `${header}.${tampered}.${sig}`
    const result   = verifyJwtRS256(token, { publicKeyPem: DEV_PUBLIC_KEY_PEM })
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('invalid_signature')
  })
})
