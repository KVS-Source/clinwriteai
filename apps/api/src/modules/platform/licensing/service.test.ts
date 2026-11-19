// Tests for LicenseService — the trust boundary between the signed JWT
// and the untrusted DB row. These cases MUST assert that a tampered row
// cannot promote modules the signed token didn't grant; failing any of
// these means a customer with DB access could grant themselves modules.

import Fastify from 'fastify'
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { createSign } from 'node:crypto'
import { LicenseService } from './service.js'
import { DEV_PRIVATE_KEY_PEM } from './keys.js'

function base64url(buf: Buffer | string): string {
  const b = typeof buf === 'string' ? Buffer.from(buf) : buf
  return b.toString('base64url')
}

function signRS256(payload: Record<string, unknown>): string {
  const header  = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const body    = base64url(JSON.stringify(payload))
  const signer  = createSign('sha256'); signer.update(`${header}.${body}`); signer.end()
  const sig     = base64url(signer.sign(DEV_PRIVATE_KEY_PEM))
  return `${header}.${body}.${sig}`
}

function validClaims(overrides: Record<string, unknown> = {}) {
  const now = Math.floor(Date.now() / 1000)
  return {
    iss:          'genbioca-licensing',
    iat:          now,
    exp:          now + 365 * 24 * 60 * 60,
    installId:    'acme-prod',
    customerName: 'Acme Pharma',
    modules:      ['A'],
    features:     ['part11_esig'],
    ...overrides,
  }
}

interface MockRow {
  id: string; token: string; installId: string; customerName: string
  issuedAt: Date; expiry: Date
  modulesSnapshot: string[]; featuresSnapshot: string[]
  importedBy: string; importedAt: Date
  isActive: boolean; revokedAt: Date | null; revokedBy: string | null; revokeReason: string | null
}

function makeRow(token: string, overrides: Partial<MockRow> = {}): MockRow {
  const now = new Date()
  return {
    id: 'lic-1', token,
    installId: 'acme-prod', customerName: 'Acme Pharma',
    issuedAt: now, expiry: new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000),
    modulesSnapshot: ['A'], featuresSnapshot: ['part11_esig'],
    importedBy: 'u1', importedAt: now,
    isActive: true, revokedAt: null, revokedBy: null, revokeReason: null,
    ...overrides,
  }
}

function buildPrisma(row: MockRow | null) {
  return {
    license: {
      findFirst: vi.fn(async () => row),
      create:    vi.fn(async ({ data }: { data: Partial<MockRow> }) => ({ id: 'lic-new', ...row, ...data } as MockRow)),
      update:    vi.fn(async () => row),
      updateMany: vi.fn(async () => ({ count: row?.isActive ? 1 : 0 })),
    },
    $transaction: vi.fn(async (fn: (tx: unknown) => Promise<unknown>) => fn({
      license: {
        updateMany: vi.fn(async () => ({ count: 0 })),
        create:     vi.fn(async ({ data }: { data: Partial<MockRow> }) => ({ id: 'lic-new', ...row, ...data })),
      },
    })),
  }
}

beforeEach(() => { delete process.env.LICENSE_DEV_MODE; delete process.env.LICENSE_PUBLIC_KEY })

describe('LicenseService.getActive — trusts only the signed JWT', () => {
  it('returns state=active when the stored token is valid + the snapshot is intact', async () => {
    const token = signRS256(validClaims({ modules: ['A', 'B'] }))
    const row = makeRow(token, { modulesSnapshot: ['A', 'B'] })
    const svc = new LicenseService(buildPrisma(row) as never)
    const view = await svc.getActive()
    expect(view.state).toBe('active')
    expect(view.modules).toEqual(['A', 'B'])
    expect(view.customerName).toBe('Acme Pharma')
  })

  it('IGNORES a tampered modulesSnapshot when the token itself is legitimate', async () => {
    // Customer edited the DB row to grant themselves modules C, D, E.
    // The signed token in the same row still only grants A — service MUST
    // return A, not the tampered list.
    const token = signRS256(validClaims({ modules: ['A'] }))
    const row = makeRow(token, {
      modulesSnapshot:  ['A', 'B', 'C', 'D', 'E'],      // tampered
      featuresSnapshot: ['part11_esig', 'premium_ai'],  // tampered
    })
    const svc = new LicenseService(buildPrisma(row) as never)
    const view = await svc.getActive()
    expect(view.state).toBe('active')
    expect(view.modules).toEqual(['A'])                 // from signed claim
    expect(view.features).toEqual(['part11_esig'])
  })

  it('returns state=invalid when the stored token has been swapped for an unsigned/garbage string', async () => {
    const row = makeRow('not-a-jwt')
    const svc = new LicenseService(buildPrisma(row) as never)
    const view = await svc.getActive()
    expect(view.state).toBe('invalid')
    expect(view.modules).toEqual([])                    // never falls back to snapshot
    expect(view.invalidReason).toBe('malformed')
  })

  it('returns state=invalid when a payload-tampered token lands in the row', async () => {
    const token = signRS256(validClaims({ modules: ['A'] }))
    // Replace the payload segment with a different one; signature no longer verifies.
    const parts = token.split('.')
    const forgedPayload = base64url(JSON.stringify(validClaims({ modules: ['A', 'B', 'C'] })))
    const forgedToken = `${parts[0]}.${forgedPayload}.${parts[2]}`
    const row = makeRow(forgedToken, { modulesSnapshot: ['A', 'B', 'C'] })
    const svc = new LicenseService(buildPrisma(row) as never)
    const view = await svc.getActive()
    expect(view.state).toBe('invalid')
    expect(view.modules).toEqual([])
    expect(view.invalidReason).toBe('invalid_signature')
  })

  it('returns state=expired when the token expiry is in the past', async () => {
    const past = Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60
    const token = signRS256(validClaims({ iat: past - 3600, exp: past }))
    const row = makeRow(token)
    const svc = new LicenseService(buildPrisma(row) as never)
    const view = await svc.getActive()
    expect(view.state).toBe('expired')
    expect(view.modules).toEqual([])
  })

  it('returns state=unlicensed when no row exists + dev mode off', async () => {
    const svc = new LicenseService(buildPrisma(null) as never)
    const view = await svc.getActive()
    expect(view.state).toBe('unlicensed')
    expect(view.modules).toEqual([])
    expect(view.invalidReason).toBe('no_row')
  })

  it('returns state=dev_mode_unlicensed with all modules when LICENSE_DEV_MODE=1 + no row', async () => {
    process.env.LICENSE_DEV_MODE = '1'
    const svc = new LicenseService(buildPrisma(null) as never)
    const view = await svc.getActive()
    expect(view.state).toBe('dev_mode_unlicensed')
    expect(view.modules).toEqual(['A', 'B', 'C', 'D', 'E'])
  })
})

describe('LicenseService.importLicense — verifies before persisting', () => {
  it('accepts a valid token + persists', async () => {
    const token = signRS256(validClaims({ modules: ['A', 'B'] }))
    const prisma = buildPrisma(null)
    // After the import transaction, getActive() should return the new row.
    // Simulate by having the prisma mock return the newly-inserted row on
    // the second findFirst call.
    const row = makeRow(token, { modulesSnapshot: ['A', 'B'] })
    prisma.license.findFirst = vi.fn(async () => row)
    const svc = new LicenseService(prisma as never)
    const result = await svc.importLicense(token, 'u1')
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.license.modules).toEqual(['A', 'B'])
    }
  })

  it('rejects a malformed token with a typed reason', async () => {
    const prisma = buildPrisma(null)
    const svc = new LicenseService(prisma as never)
    const result = await svc.importLicense('not-a-jwt', 'u1')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('malformed')
    expect(prisma.$transaction).not.toHaveBeenCalled()
  })

  it('rejects a token with mismatched issuer', async () => {
    const token = signRS256(validClaims({ iss: 'someone-else' }))
    const prisma = buildPrisma(null)
    const svc = new LicenseService(prisma as never)
    const result = await svc.importLicense(token, 'u1')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('issuer_mismatch')
  })

  it('rejects a token whose claims fail the schema (missing installId)', async () => {
    const claims = validClaims()
    delete (claims as Record<string, unknown>).installId
    const token = signRS256(claims)
    const prisma = buildPrisma(null)
    const svc = new LicenseService(prisma as never)
    const result = await svc.importLicense(token, 'u1')
    expect(result.ok).toBe(false)
    if (!result.ok) expect(result.reason).toBe('schema_mismatch')
  })
})

describe('LicenseService wired through Fastify route', () => {
  it('GET /license re-verifies on every call — tampered snapshot never widens modules', async () => {
    const token = signRS256(validClaims({ modules: ['A'] }))
    const row = makeRow(token, { modulesSnapshot: ['A', 'B', 'C', 'D', 'E'] })
    const prisma = buildPrisma(row)
    const app = Fastify()
    app.decorate('prisma', prisma as never)
    app.decorate('audit',  { append: vi.fn() } as never)
    app.decorateRequest('user', null)
    app.addHook('onRequest', async (req) => {
      ;(req as unknown as { user: { id: string; role: string; modules: string[]; tenantId: string } }).user =
        { id: 'u1', role: 'admin', modules: ['A'], tenantId: 't1' }
    })
    const { licenseRoutes } = await import('./routes.js')
    await app.register(licenseRoutes, { prefix: '/license' })
    const res = await app.inject({ method: 'GET', url: '/license' })
    expect(res.statusCode).toBe(200)
    const body = res.json()
    expect(body.state).toBe('active')
    expect(body.modules).toEqual(['A'])
  })
})
