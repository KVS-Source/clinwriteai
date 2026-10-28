import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { _resetEnabledModulesCache, enabledModules, hasCapability, hasModuleAccess, hasRole, isModuleEnabled, type AuthenticatedUser } from './rbac.js'

const base: AuthenticatedUser = {
  id: 'u-1',
  email: 'u@clinwrite.ai',
  role: 'contributor',
  capabilities: ['can-author'],
  modules: ['A'],
  tenantId: null,
}

describe('hasModuleAccess', () => {
  it('tenant-admin bypasses module gating', () => {
    expect(hasModuleAccess({ ...base, role: 'tenant-admin', modules: [] }, ['C', 'D'])).toBe(true)
  })

  it('legacy admin role still bypasses module gating (pre-migration-48 users)', () => {
    expect(hasModuleAccess({ ...base, role: 'admin', modules: [] }, ['E'])).toBe(true)
  })

  it('empty required-modules list permits any user', () => {
    expect(hasModuleAccess(base, [])).toBe(true)
  })

  it('grants access when user has any required module', () => {
    expect(hasModuleAccess({ ...base, modules: ['A', 'C'] }, ['C', 'D'])).toBe(true)
  })

  it('denies when user has no overlapping module', () => {
    expect(hasModuleAccess({ ...base, modules: ['A'] }, ['C', 'D'])).toBe(false)
  })
})

describe('hasRole', () => {
  it('empty role list permits any role', () => {
    expect(hasRole(base, [])).toBe(true)
  })

  it('matches when user role is in the required set', () => {
    expect(hasRole({ ...base, role: 'tenant-admin' }, ['tenant-admin', 'auditor'])).toBe(true)
  })

  it('denies when user role is not in the required set', () => {
    expect(hasRole(base, ['tenant-admin'])).toBe(false)
  })

  it('admin role does NOT auto-pass arbitrary role gates (role list is explicit)', () => {
    // Rationale: `requireAuth({ roles: ['reviewer'] })` is a scoped grant;
    // admins should route through admin-specific endpoints, not elbow into
    // reviewer flows.
    expect(hasRole({ ...base, role: 'tenant-admin' }, ['reviewer'])).toBe(false)
  })

  // --- Legacy ↔ canonical compat (see rbac.ts) ------------------------------

  it('legacy "admin" required accepts a canonical tenant-admin user', () => {
    expect(hasRole({ ...base, role: 'tenant-admin' }, ['admin'])).toBe(true)
  })

  it('canonical "tenant-admin" required accepts a legacy admin user', () => {
    expect(hasRole({ ...base, role: 'admin' }, ['tenant-admin'])).toBe(true)
  })

  it('legacy "reviewer" required accepts a contributor WITH can-review', () => {
    expect(hasRole({ ...base, role: 'contributor', capabilities: ['can-review'] }, ['reviewer'])).toBe(true)
  })

  it('legacy "reviewer" required rejects a contributor WITHOUT can-review', () => {
    expect(hasRole({ ...base, role: 'contributor', capabilities: ['can-author'] }, ['reviewer'])).toBe(false)
  })

  it('legacy "read-only" required accepts a canonical auditor user', () => {
    expect(hasRole({ ...base, role: 'auditor', capabilities: [] }, ['read-only'])).toBe(true)
  })

  it('canonical "contributor" required accepts legacy writer-flavour users', () => {
    expect(hasRole({ ...base, role: 'clinical-writer' }, ['contributor'])).toBe(true)
    expect(hasRole({ ...base, role: 'medical-writer' }, ['contributor'])).toBe(true)
    expect(hasRole({ ...base, role: 'reviewer' }, ['contributor'])).toBe(true)
  })
})

describe('hasCapability', () => {
  it('returns true when the capability is present', () => {
    expect(hasCapability({ ...base, capabilities: ['can-review', 'can-approve'] }, 'can-approve')).toBe(true)
  })

  it('returns false when the capability is missing', () => {
    expect(hasCapability({ ...base, capabilities: ['can-author'] }, 'can-approve')).toBe(false)
  })

  it('returns false when capabilities is undefined (pre-migration users)', () => {
    expect(hasCapability({ ...base, capabilities: undefined }, 'can-author')).toBe(false)
  })
})

describe('isModuleEnabled (deployment kill-switch)', () => {
  const original = process.env.FEATURE_MODULES_ENABLED

  beforeEach(() => { _resetEnabledModulesCache() })
  afterEach(() => {
    if (original === undefined) delete process.env.FEATURE_MODULES_ENABLED
    else process.env.FEATURE_MODULES_ENABLED = original
    _resetEnabledModulesCache()
  })

  it('defaults to every module (A,B,C,D,E) when env is unset', () => {
    // The 2026-10-06 pivot's 'A'-only default was flipped 2026-10-21
    // after Arc 11 re-enabled B/C/D/E for API+DB build-out. Deployments
    // that want to re-freeze must explicitly set FEATURE_MODULES_ENABLED=A.
    delete process.env.FEATURE_MODULES_ENABLED
    _resetEnabledModulesCache()
    expect(new Set(Array.from(enabledModules()))).toEqual(new Set(['A', 'B', 'C', 'D', 'E']))
    expect(isModuleEnabled(['A'])).toBe(true)
    expect(isModuleEnabled(['B'])).toBe(true)
    expect(isModuleEnabled(['E'])).toBe(true)
  })

  it('parses comma-separated list, upper-casing and trimming', () => {
    process.env.FEATURE_MODULES_ENABLED = ' a, c ,E '
    _resetEnabledModulesCache()
    expect(new Set(Array.from(enabledModules()))).toEqual(new Set(['A', 'C', 'E']))
    expect(isModuleEnabled(['C'])).toBe(true)
    expect(isModuleEnabled(['B'])).toBe(false)
  })

  it('ignores unknown module keys, falling back to A if list ends empty', () => {
    process.env.FEATURE_MODULES_ENABLED = 'X,Y,Z'
    _resetEnabledModulesCache()
    expect(Array.from(enabledModules())).toEqual(['A'])
  })

  it('treats an empty required list as always enabled (route is not module-scoped)', () => {
    process.env.FEATURE_MODULES_ENABLED = 'A'
    _resetEnabledModulesCache()
    expect(isModuleEnabled([])).toBe(true)
  })

  it('passes when any required module is enabled', () => {
    process.env.FEATURE_MODULES_ENABLED = 'A,D'
    _resetEnabledModulesCache()
    expect(isModuleEnabled(['B', 'D'])).toBe(true)
  })
})
