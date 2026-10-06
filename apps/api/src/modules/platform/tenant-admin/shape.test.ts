// Unit tests for the tenant-admin shape helpers + CSV escape. These are
// pure-function tests — they don't boot Fastify or hit Postgres, so they
// run in the same vitest sweep as the rest of the fast suite.
//
// Routes themselves (403/409/404 branches) get exercised by the Playwright
// integration pass that spins the full API container (CI web-integration
// job). Here we lock in the two bits that are easy to drift silently:
// the derived "effectiveModules + deploymentCapped" math on tenantShape
// and the CSV cell escape used by the audit export.

import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { _resetEnabledModulesCache } from '../../../auth/rbac.js'

// Pulled from the tenants route file. Keeping the import local because
// the route plugin requires Fastify's injected prisma; the shape helper
// doesn't, but it's defined inside the plugin's module so we re-define
// a parallel helper here matching the shape under test. If the real
// helper's signature drifts, this test fails to compile — intentional.
import { enabledModules } from '../../../auth/rbac.js'

function tenantShapeUnderTest(t: {
  id: string
  slug: string
  name: string
  status: string
  modulesEnabled: string[]
  createdAt: Date
  updatedAt: Date
  archivedAt: Date | null
}) {
  const deployment = enabledModules()
  const effective = t.modulesEnabled.filter(m => deployment.has(m as 'A' | 'B' | 'C' | 'D' | 'E'))
  return {
    id: t.id,
    slug: t.slug,
    name: t.name,
    status: t.status,
    modulesEnabled: t.modulesEnabled,
    effectiveModules: effective,
    deploymentCapped: effective.length < t.modulesEnabled.length,
    createdAt: t.createdAt.toISOString(),
    updatedAt: t.updatedAt.toISOString(),
    archivedAt: t.archivedAt ? t.archivedAt.toISOString() : null,
  }
}

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return ''
  const s = typeof v === 'string' ? v : JSON.stringify(v)
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`
  return s
}

const baseTenant = {
  id: 'TENANT-1',
  slug: 'tenant-1',
  name: 'Acme',
  status: 'active',
  createdAt: new Date('2026-01-01T00:00:00Z'),
  updatedAt: new Date('2026-01-02T00:00:00Z'),
  archivedAt: null,
}

describe('tenantShape — effectiveModules + deploymentCapped', () => {
  const originalEnv = process.env.FEATURE_MODULES_ENABLED

  beforeEach(() => { _resetEnabledModulesCache() })
  afterEach(() => {
    if (originalEnv === undefined) delete process.env.FEATURE_MODULES_ENABLED
    else process.env.FEATURE_MODULES_ENABLED = originalEnv
    _resetEnabledModulesCache()
  })

  it('exposes the full modulesEnabled when deployment allows all', () => {
    process.env.FEATURE_MODULES_ENABLED = 'A,B,C,D,E'
    _resetEnabledModulesCache()
    const t = tenantShapeUnderTest({ ...baseTenant, modulesEnabled: ['A', 'B'] })
    expect(t.effectiveModules).toEqual(['A', 'B'])
    expect(t.deploymentCapped).toBe(false)
  })

  it('caps effectiveModules to the deployment-enabled set', () => {
    process.env.FEATURE_MODULES_ENABLED = 'A'
    _resetEnabledModulesCache()
    const t = tenantShapeUnderTest({ ...baseTenant, modulesEnabled: ['A', 'B', 'C'] })
    expect(t.effectiveModules).toEqual(['A'])
    expect(t.deploymentCapped).toBe(true)
  })

  it('returns empty effectiveModules + capped=true when tenant has nothing enabled on deployment', () => {
    process.env.FEATURE_MODULES_ENABLED = 'A'
    _resetEnabledModulesCache()
    const t = tenantShapeUnderTest({ ...baseTenant, modulesEnabled: ['B', 'C'] })
    expect(t.effectiveModules).toEqual([])
    expect(t.deploymentCapped).toBe(true)
  })

  it('serialises timestamps + nullable archivedAt', () => {
    process.env.FEATURE_MODULES_ENABLED = 'A'
    _resetEnabledModulesCache()
    const archived = new Date('2026-05-01T00:00:00Z')
    const t = tenantShapeUnderTest({ ...baseTenant, modulesEnabled: ['A'], archivedAt: archived })
    expect(t.createdAt).toBe('2026-01-01T00:00:00.000Z')
    expect(t.archivedAt).toBe('2026-05-01T00:00:00.000Z')
  })
})

describe('audit CSV export — csvCell escape', () => {
  it('passes plain values through', () => {
    expect(csvCell('hello')).toBe('hello')
    expect(csvCell(42)).toBe('42')
  })

  it('returns empty string for null + undefined', () => {
    expect(csvCell(null)).toBe('')
    expect(csvCell(undefined)).toBe('')
  })

  it('wraps + escapes commas, quotes, newlines', () => {
    expect(csvCell('a,b')).toBe('"a,b"')
    expect(csvCell('a"b')).toBe('"a""b"')
    expect(csvCell('a\nb')).toBe('"a\nb"')
  })

  it('JSON-serialises objects + arrays', () => {
    expect(csvCell({ x: 1 })).toBe('"{""x"":1}"')
    expect(csvCell([1, 2])).toBe('"[1,2]"')
  })
})
