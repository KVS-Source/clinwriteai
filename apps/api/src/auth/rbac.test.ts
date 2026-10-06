import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { _resetEnabledModulesCache, enabledModules, hasModuleAccess, hasRole, isModuleEnabled, type AuthenticatedUser } from './rbac.js'

const base: AuthenticatedUser = {
  id: 'u-1',
  email: 'u@clinwrite.ai',
  role: 'clinical-writer',
  modules: ['A'],
  tenantId: null,
}

describe('hasModuleAccess', () => {
  it('super-admin bypasses module gating', () => {
    expect(hasModuleAccess({ ...base, role: 'super-admin', modules: [] }, ['C', 'D'])).toBe(true)
  })

  it('admin bypasses module gating', () => {
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
    expect(hasRole({ ...base, role: 'reviewer' }, ['reviewer', 'admin'])).toBe(true)
  })

  it('denies when user role is not in the required set', () => {
    expect(hasRole(base, ['admin'])).toBe(false)
  })

  it('admin role does NOT auto-pass arbitrary role gates (role list is explicit)', () => {
    // Rationale: `requireAuth({ roles: ['reviewer'] })` is a scoped grant;
    // admins should route through admin-specific endpoints, not elbow into
    // reviewer flows. If we ever change this, update this test deliberately.
    expect(hasRole({ ...base, role: 'admin' }, ['reviewer'])).toBe(false)
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

  it('defaults to Module A when env is unset', () => {
    delete process.env.FEATURE_MODULES_ENABLED
    _resetEnabledModulesCache()
    expect(Array.from(enabledModules())).toEqual(['A'])
    expect(isModuleEnabled(['A'])).toBe(true)
    expect(isModuleEnabled(['B'])).toBe(false)
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
