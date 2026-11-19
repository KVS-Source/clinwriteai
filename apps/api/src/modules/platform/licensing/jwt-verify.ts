// RS256 JWT verification using Node's built-in `crypto`. No third-party
// dependency — easier to audit for a security-critical path.
//
// JWT format: <base64url(header)>.<base64url(payload)>.<base64url(signature)>
// Signature: RSA-SHA256 over `<headerB64>.<payloadB64>` with the issuer's
// private key. Verification uses the issuer's public key.
//
// This helper intentionally does the bare minimum: RS256 only, exp/nbf
// checked with ±60s clock skew, header validation. Other JWT features
// (nested JWS, unencoded payload, kid-based key rotation) are not
// supported — our licensing use case doesn't need them.

import { createVerify } from 'node:crypto'

/** Standard JWT claims the verifier enforces. */
interface StandardClaims {
  exp?: number     // expiry, seconds since epoch
  nbf?: number     // not-before, seconds since epoch
  iat?: number     // issued-at, seconds since epoch (informational, not enforced)
  iss?: string     // issuer (optional; caller checks against expected)
}

export type VerifyResult<T> =
  | { ok: true;  payload: T & StandardClaims }
  | { ok: false; reason: VerifyFailureReason; message: string }

export type VerifyFailureReason =
  | 'malformed'
  | 'unsupported_algorithm'
  | 'invalid_signature'
  | 'expired'
  | 'not_yet_valid'
  | 'issuer_mismatch'

/** Max allowed clock skew between issuer and this server, in seconds. */
const CLOCK_SKEW_SECONDS = 60

function base64urlDecode(input: string): Buffer {
  // Node's base64url decoder tolerates missing padding + '-'/'_' chars.
  return Buffer.from(input, 'base64url')
}

export interface VerifyOptions {
  /** PEM-encoded RSA public key (SPKI or PKCS#1). */
  publicKeyPem: string
  /** Expected `iss` claim. When provided, a mismatch returns `issuer_mismatch`. */
  issuer?: string
  /** `now` override for deterministic tests (seconds since epoch). */
  now?: number
}

export function verifyJwtRS256<T = Record<string, unknown>>(
  token: string,
  opts:  VerifyOptions,
): VerifyResult<T> {
  // --- Shape check -----------------------------------------------------
  const parts = token.split('.')
  if (parts.length !== 3) {
    return { ok: false, reason: 'malformed', message: `expected 3 dot-separated parts, got ${parts.length}` }
  }
  const [headerB64, payloadB64, signatureB64] = parts as [string, string, string]

  // --- Header check ----------------------------------------------------
  let header: { alg?: string; typ?: string }
  try {
    header = JSON.parse(base64urlDecode(headerB64).toString('utf8'))
  } catch {
    return { ok: false, reason: 'malformed', message: 'header is not valid base64url JSON' }
  }
  if (header.alg !== 'RS256') {
    return { ok: false, reason: 'unsupported_algorithm', message: `expected alg=RS256, got ${header.alg ?? 'missing'}` }
  }

  // --- Signature verification -----------------------------------------
  // Signing input is the exact bytes from the token, not re-encoded.
  const signingInput = `${headerB64}.${payloadB64}`
  const verifier = createVerify('sha256')
  verifier.update(signingInput)
  verifier.end()
  let signatureValid: boolean
  try {
    signatureValid = verifier.verify(opts.publicKeyPem, base64urlDecode(signatureB64))
  } catch (err) {
    // crypto throws on malformed PEM / unrecognised key format.
    return { ok: false, reason: 'invalid_signature', message: `verify threw: ${err instanceof Error ? err.message : String(err)}` }
  }
  if (!signatureValid) {
    return { ok: false, reason: 'invalid_signature', message: 'signature did not verify against the provided public key' }
  }

  // --- Payload decode --------------------------------------------------
  let payload: Record<string, unknown>
  try {
    payload = JSON.parse(base64urlDecode(payloadB64).toString('utf8'))
  } catch {
    return { ok: false, reason: 'malformed', message: 'payload is not valid base64url JSON' }
  }

  // --- Standard-claim checks ------------------------------------------
  const now = opts.now ?? Math.floor(Date.now() / 1000)

  const exp = typeof payload.exp === 'number' ? payload.exp : undefined
  const nbf = typeof payload.nbf === 'number' ? payload.nbf : undefined
  const iss = typeof payload.iss === 'string' ? payload.iss : undefined

  if (exp !== undefined && now > exp + CLOCK_SKEW_SECONDS) {
    return { ok: false, reason: 'expired', message: `token expired at ${new Date(exp * 1000).toISOString()}` }
  }
  if (nbf !== undefined && now + CLOCK_SKEW_SECONDS < nbf) {
    return { ok: false, reason: 'not_yet_valid', message: `token not valid until ${new Date(nbf * 1000).toISOString()}` }
  }
  if (opts.issuer !== undefined && iss !== opts.issuer) {
    return { ok: false, reason: 'issuer_mismatch', message: `expected iss=${opts.issuer}, got ${iss ?? 'missing'}` }
  }

  return { ok: true, payload: payload as T & StandardClaims }
}
