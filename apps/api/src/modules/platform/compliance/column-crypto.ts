// Column-level encryption helper — Arc 9.1.
//
// Interim pgcrypto-based envelope encryption for mobile fields on
// KolContact + MaContact (HIPAA DPIA action item). The design is
// deliberately pluggable so a KMS swap (AWS KMS, HashiCorp Vault,
// GCP KMS) is a provider-class change, not a call-site refactor.
//
// Current provider: AES-256-GCM via Node's native crypto using a key
// loaded from env (COLUMN_ENC_KEY, 32 raw bytes hex-encoded). The
// stored ciphertext format is `v1:${iv_hex}:${tag_hex}:${ct_hex}` so a
// future KMS swap can be versioned without a migration.
//
// Why not pgcrypto directly: having the ciphertext opaque to Postgres
// means the DB operator can't accidentally see plaintext in a query,
// and the key never leaves the API process. pgcrypto would require
// the key to be passed in on every SELECT, which leaks it into logs.

import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from 'node:crypto'

const VERSION_PREFIX = 'v1'
const IV_BYTES = 12            // GCM standard
const KEY_BYTES = 32           // AES-256

function loadKey(): Buffer {
  const raw = process.env.COLUMN_ENC_KEY?.trim()
  if (raw) {
    // Hex-encoded 32-byte key (64 hex chars).
    if (raw.length === 64) return Buffer.from(raw, 'hex')
    // Fallback: derive via scrypt from a passphrase. Not for prod but
    // keeps dev + tests working without rotating the key every boot.
    return scryptSync(raw, 'platform-column-crypto-v1', KEY_BYTES)
  }
  // No key set — only acceptable in dev / CI. Derive deterministically
  // from a well-known string so the same ciphertext round-trips across
  // restarts. A production boot should fail loudly instead; see Arc 12
  // launch-readiness gate (12.5).
  if (process.env.NODE_ENV === 'production') {
    throw new Error('COLUMN_ENC_KEY must be set in production — refusing to boot without a column encryption key.')
  }
  return scryptSync('dev-fallback-column-crypto-key', 'platform-column-crypto-v1', KEY_BYTES)
}

let cachedKey: Buffer | null = null
function key(): Buffer {
  return (cachedKey ??= loadKey())
}

/**
 * Encrypt a plaintext value for storage in a column. Returns a
 * self-describing string that encodes version + IV + auth tag +
 * ciphertext. Safe to pass to a Prisma `String` column.
 */
export function encryptColumn(plaintext: string | null): string | null {
  if (plaintext == null) return null
  const iv = randomBytes(IV_BYTES)
  const cipher = createCipheriv('aes-256-gcm', key(), iv)
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return `${VERSION_PREFIX}:${iv.toString('hex')}:${tag.toString('hex')}:${ct.toString('hex')}`
}

/**
 * Decrypt a value previously produced by `encryptColumn`. Returns null
 * for null input; throws if the ciphertext is malformed or auth tag
 * verification fails (indicates tampering or wrong key).
 *
 * Values that don't start with the version prefix are returned as-is —
 * supports a gradual rollout where some rows are plaintext legacy data.
 */
export function decryptColumn(stored: string | null): string | null {
  if (stored == null) return null
  if (!stored.startsWith(`${VERSION_PREFIX}:`)) return stored    // legacy plaintext

  const parts = stored.split(':')
  if (parts.length !== 4) throw new Error('malformed_ciphertext')
  const ivHex  = parts[1]
  const tagHex = parts[2]
  const ctHex  = parts[3]
  if (!ivHex || !tagHex || !ctHex) throw new Error('malformed_ciphertext')
  const iv  = Buffer.from(ivHex, 'hex')
  const tag = Buffer.from(tagHex, 'hex')
  const ct  = Buffer.from(ctHex, 'hex')
  const decipher = createDecipheriv('aes-256-gcm', key(), iv)
  decipher.setAuthTag(tag)
  const pt = Buffer.concat([decipher.update(ct), decipher.final()])
  return pt.toString('utf8')
}

// Test-only — don't call from production code.
export function _resetKeyCache(): void {
  cachedKey = null
}
