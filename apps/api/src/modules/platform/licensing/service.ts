// LicenseService — verify + persist + read the per-install licensing token.
//
// Design contract: the DB row is UNTRUSTED. Every read re-verifies the
// JWT signature via `verifyJwtRS256` and re-parses the claims through
// Zod. `modulesSnapshot` / `featuresSnapshot` on the row are a DISPLAY
// cache only — the auth path never reads them.
//
// Lifecycle: exactly one row is `isActive=true` at a time. Importing
// a new token flips the previous active row to inactive atomically
// (enforced by the unique partial index in migration 92; the service
// does the flip inside a transaction for crash-safety).

import type { PrismaClient, Prisma } from '@prisma/client'
import { verifyJwtRS256, type VerifyFailureReason } from './jwt-verify.js'
import { resolveLicensePublicKey, isLicenseDevMode, EXPECTED_ISSUER } from './keys.js'
import { licenseClaimsSchema } from './schema.js'

// --- public result shapes -----------------------------------------------

/** What the auth path + /license GET return. Always safe to serialise —
 *  no secrets. The raw token is never exposed on reads. */
export interface ActiveLicenseView {
  // `dev_mode_unlicensed` fires when LICENSE_DEV_MODE=1 AND no row.
  // `auto_dev_unlicensed` fires when the dev public key is in use AND
  // no row — same effective behaviour (all modules enabled with a
  // warning) but detected automatically so demo/staging installs
  // don't need an env flag.
  state:          'active' | 'expired' | 'invalid' | 'dev_mode_unlicensed' | 'auto_dev_unlicensed' | 'unlicensed'
  publicKeySource: 'env' | 'dev_fallback'
  installId:      string | null
  customerName:   string | null
  modules:        string[]                          // authoritative (from signed claim), NOT the DB snapshot
  features:       string[]
  issuedAt:       string | null
  expiry:         string | null
  importedAt:     string | null
  importedBy:     string | null
  // Set only when state !== 'active' — tells IT admin exactly why.
  invalidReason?: VerifyFailureReason | 'schema_mismatch' | 'no_row'
  invalidDetail?: string
  // Days until expiry (negative when expired). Null when unlicensed.
  daysToExpiry:   number | null
}

export type ImportResult =
  | { ok: true;  license: ActiveLicenseView }
  | { ok: false; reason: VerifyFailureReason | 'schema_mismatch'; message: string }

// --- service -------------------------------------------------------------

export class LicenseService {
  constructor(private readonly prisma: PrismaClient) {}

  /** Read the active row, re-verify the JWT, return a view suitable for
   *  the admin UI + the module gate. Never trusts the row's snapshot
   *  columns — only what's inside the signed token. */
  async getActive(): Promise<ActiveLicenseView> {
    const { pem, source: publicKeySource } = resolveLicensePublicKey()
    const row = await this.prisma.license.findFirst({
      where:   { isActive: true, revokedAt: null },
      orderBy: { importedAt: 'desc' },
    })

    if (!row) {
      if (isLicenseDevMode()) {
        return {
          state: 'dev_mode_unlicensed',
          publicKeySource,
          installId: 'dev', customerName: 'Dev install',
          modules:  ['A', 'B', 'C', 'D', 'E'],
          features: [],
          issuedAt: null, expiry: null, importedAt: null, importedBy: null,
          daysToExpiry: null,
        }
      }
      // Dev-public-key auto-unlock: an install that hasn't configured
      // LICENSE_PUBLIC_KEY is inherently not production. Rather than
      // strand demo/staging installs behind a 503 wall during the
      // licence rollout, grant all modules here and surface it in the
      // UI as an actionable state (so it's still obvious this isn't a
      // real licence). Production installs set LICENSE_PUBLIC_KEY and
      // fall through to the strict `unlicensed` branch below.
      if (publicKeySource === 'dev_fallback') {
        return {
          state: 'auto_dev_unlicensed',
          publicKeySource,
          installId: 'auto-dev', customerName: 'Demo / staging install',
          modules:  ['A', 'B', 'C', 'D', 'E'],
          features: [],
          issuedAt: null, expiry: null, importedAt: null, importedBy: null,
          daysToExpiry: null,
          invalidReason: 'no_row',
          invalidDetail: 'No signed licence imported — all modules auto-enabled because LICENSE_PUBLIC_KEY is not configured. Set the GenBioCa public key + import a real token for strict gating.',
        }
      }
      return {
        state: 'unlicensed', publicKeySource,
        installId: null, customerName: null,
        modules: [], features: [],
        issuedAt: null, expiry: null, importedAt: null, importedBy: null,
        daysToExpiry: null,
        invalidReason: 'no_row',
        invalidDetail: 'No active license imported. Import a token issued by GenBioCa on Settings → Licensing.',
      }
    }

    const verified = verifyJwtRS256<Record<string, unknown>>(row.token, { publicKeyPem: pem, issuer: EXPECTED_ISSUER })
    if (!verified.ok) {
      return {
        state: verified.reason === 'expired' ? 'expired' : 'invalid',
        publicKeySource,
        installId: row.installId, customerName: row.customerName,
        modules: [], features: [],
        issuedAt: row.issuedAt.toISOString(), expiry: row.expiry.toISOString(),
        importedAt: row.importedAt.toISOString(), importedBy: row.importedBy,
        invalidReason: verified.reason, invalidDetail: verified.message,
        daysToExpiry: daysBetween(new Date(), row.expiry),
      }
    }

    const claims = licenseClaimsSchema.safeParse(verified.payload)
    if (!claims.success) {
      return {
        state: 'invalid', publicKeySource,
        installId: row.installId, customerName: row.customerName,
        modules: [], features: [],
        issuedAt: row.issuedAt.toISOString(), expiry: row.expiry.toISOString(),
        importedAt: row.importedAt.toISOString(), importedBy: row.importedBy,
        invalidReason: 'schema_mismatch',
        invalidDetail: `token verified but claims failed schema: ${claims.error.issues[0]?.message ?? 'unknown'}`,
        daysToExpiry: daysBetween(new Date(), row.expiry),
      }
    }

    return {
      state: 'active', publicKeySource,
      installId: claims.data.installId,
      customerName: claims.data.customerName,
      modules: claims.data.modules,
      features: claims.data.features,
      issuedAt: row.issuedAt.toISOString(),
      expiry: row.expiry.toISOString(),
      importedAt: row.importedAt.toISOString(),
      importedBy: row.importedBy,
      daysToExpiry: daysBetween(new Date(), row.expiry),
    }
  }

  /** Verify + import a new token. Rejects malformed / expired / wrong-issuer
   *  tokens; the UI surfaces the structured reason so IT admin can act. */
  async importLicense(token: string, actorId: string): Promise<ImportResult> {
    const { pem } = resolveLicensePublicKey()
    const verified = verifyJwtRS256<Record<string, unknown>>(token, { publicKeyPem: pem, issuer: EXPECTED_ISSUER })
    if (!verified.ok) return { ok: false, reason: verified.reason, message: verified.message }

    const claims = licenseClaimsSchema.safeParse(verified.payload)
    if (!claims.success) {
      return { ok: false, reason: 'schema_mismatch', message: claims.error.issues[0]?.message ?? 'claims validation failed' }
    }

    // Persist atomically: flip previous active rows to inactive + insert
    // new row. The partial unique index enforces the single-active rule
    // at the DB level — this transaction just keeps writes consistent.
    const row = await this.prisma.$transaction(async (tx) => {
      await tx.license.updateMany({
        where: { isActive: true },
        data:  { isActive: false },
      })
      return tx.license.create({
        data: {
          token,
          installId:        claims.data.installId,
          customerName:     claims.data.customerName,
          issuedAt:         claims.data.iat ? new Date(claims.data.iat * 1000) : new Date(),
          expiry:           claims.data.exp ? new Date(claims.data.exp * 1000) : new Date(Date.now() + 365 * 24 * 60 * 60 * 1000),
          modulesSnapshot:  claims.data.modules,
          featuresSnapshot: claims.data.features,
          importedBy:       actorId,
          isActive:         true,
        } satisfies Prisma.LicenseUncheckedCreateInput,
      })
    })

    return { ok: true, license: await this.toView(row.id) }
  }

  private async toView(licenseId: string): Promise<ActiveLicenseView> {
    // Re-use the same read path so the return value is identical to
    // what a subsequent getActive() would produce.
    const current = await this.getActive()
    // Sanity: should be the row we just created; if not, return the
    // active one anyway (callers care about state, not the exact id).
    void licenseId
    return current
  }
}

function daysBetween(from: Date, to: Date): number {
  const ms = to.getTime() - from.getTime()
  return Math.round(ms / (24 * 60 * 60 * 1000))
}
