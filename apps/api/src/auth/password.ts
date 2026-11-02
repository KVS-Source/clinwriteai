// Password hashing + token helpers (Phase A, 2026-11-02).
//
// Single place that knows how we store passwords + reset tokens, so a
// future algorithm migration (bcrypt → argon2id) is a one-file change.
//
// bcrypt (not argon2) because:
//   - zero native build steps on Windows dev machines + the standalone
//     VPS image we ship (ADR 0007). argon2 pulls libsodium.
//   - 12 rounds puts a single hash around ~100ms on modern hardware,
//     comfortably above the 10-year GPU-attack floor documented in
//     OWASP ASVS v4 §2.4.4 (cost ≥ 10).
//
// Reset tokens follow the same shape as UserInvitation.tokenHash:
// generate 32 bytes of randomness, hand the raw hex to the user in the
// email link, store ONLY the SHA-256 of it in the DB. A leaked DB
// snapshot cannot be converted back into live reset links.

import bcrypt from 'bcryptjs'
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto'

/** OWASP ASVS v4 §2.4.4 floor + modern hardware headroom. */
const BCRYPT_ROUNDS = 12

/** Policy floor. GxP-leaning: 12 chars with mixed character classes.
 *  Rules checked server-side on every password-set endpoint so a
 *  compromised client can't bypass the chrome. */
export const PASSWORD_MIN_LENGTH = 12
export const PASSWORD_MAX_LENGTH = 128

export interface PasswordPolicyIssue {
  code: 'too_short' | 'too_long' | 'needs_upper' | 'needs_lower' | 'needs_digit' | 'needs_symbol'
  message: string
}

/** Returns [] when the password passes policy; populated otherwise. */
export function validatePasswordPolicy(password: string): PasswordPolicyIssue[] {
  const issues: PasswordPolicyIssue[] = []
  if (password.length < PASSWORD_MIN_LENGTH) {
    issues.push({ code: 'too_short', message: `Password must be at least ${PASSWORD_MIN_LENGTH} characters.` })
  }
  if (password.length > PASSWORD_MAX_LENGTH) {
    issues.push({ code: 'too_long', message: `Password must be at most ${PASSWORD_MAX_LENGTH} characters.` })
  }
  if (!/[A-Z]/.test(password)) issues.push({ code: 'needs_upper', message: 'Must include an uppercase letter.' })
  if (!/[a-z]/.test(password)) issues.push({ code: 'needs_lower', message: 'Must include a lowercase letter.' })
  if (!/[0-9]/.test(password)) issues.push({ code: 'needs_digit', message: 'Must include a digit.' })
  if (!/[^A-Za-z0-9]/.test(password)) issues.push({ code: 'needs_symbol', message: 'Must include a symbol.' })
  return issues
}

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, BCRYPT_ROUNDS)
}

export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  return bcrypt.compare(plain, hash)
}

/** Deterministic constant-time string equality for same-length hashes. */
export function safeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  return timingSafeEqual(Buffer.from(a), Buffer.from(b))
}

export interface ResetTokenPair {
  /** URL-safe hex handed to the user in the email link. */
  rawToken: string
  /** SHA-256 of the raw token — only this ever hits the DB. */
  tokenHash: string
}

export function generateResetToken(): ResetTokenPair {
  const rawToken = randomBytes(32).toString('hex')
  const tokenHash = hashResetToken(rawToken)
  return { rawToken, tokenHash }
}

export function hashResetToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex')
}

/** Short, human-dictatable temp password for admin-triggered resets.
 *  12 chars, mixed case + digits + a symbol, drawn from a URL-safe
 *  alphabet that minimises visual ambiguity (no 0 / O / 1 / l / I). */
const TEMP_PW_UPPER = 'ABCDEFGHJKLMNPQRSTUVWXYZ'
const TEMP_PW_LOWER = 'abcdefghjkmnpqrstuvwxyz'
const TEMP_PW_DIGIT = '23456789'
const TEMP_PW_SYMBOL = '!@#$%&*-+='

export function generateTempPassword(): string {
  const chars = [
    pick(TEMP_PW_UPPER),
    pick(TEMP_PW_LOWER),
    pick(TEMP_PW_DIGIT),
    pick(TEMP_PW_SYMBOL),
  ]
  const all = TEMP_PW_UPPER + TEMP_PW_LOWER + TEMP_PW_DIGIT + TEMP_PW_SYMBOL
  while (chars.length < PASSWORD_MIN_LENGTH) chars.push(pick(all))
  // Fisher-Yates — crypto-random, so the required-char positions are not
  // predictable (bruteforcer can't skip "always one symbol at position 3").
  for (let i = chars.length - 1; i > 0; i--) {
    const j = Math.floor(cryptoRandomFloat() * (i + 1))
    const t = chars[i]!
    chars[i] = chars[j]!
    chars[j] = t
  }
  return chars.join('')
}

function pick(alphabet: string): string {
  return alphabet.charAt(Math.floor(cryptoRandomFloat() * alphabet.length))
}

function cryptoRandomFloat(): number {
  return randomBytes(4).readUInt32BE(0) / 0x1_0000_0000
}
