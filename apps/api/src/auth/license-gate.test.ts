// Phase 2 gate wiring — the licence override in rbac.ts must drive the
// module kill-switch, with the env var acting only as a fallback when
// no licence has set the override yet.

import { beforeEach, describe, expect, it } from 'vitest'
import {
  _resetEnabledModulesCache,
  enabledModules,
  isModuleEnabled,
  setLicenseModules,
} from './rbac.js'

beforeEach(() => {
  _resetEnabledModulesCache()
  delete process.env.FEATURE_MODULES_ENABLED
})

describe('env-var fallback — used when no licence override is set', () => {
  it('defaults to every module when FEATURE_MODULES_ENABLED is absent', () => {
    expect(enabledModules()).toEqual(new Set(['A', 'B', 'C', 'D', 'E']))
    expect(isModuleEnabled(['A'])).toBe(true)
    expect(isModuleEnabled(['D'])).toBe(true)
  })

  it('narrows to the env-var list when provided', () => {
    process.env.FEATURE_MODULES_ENABLED = 'A,C'
    expect(enabledModules()).toEqual(new Set(['A', 'C']))
    expect(isModuleEnabled(['C'])).toBe(true)
    expect(isModuleEnabled(['B'])).toBe(false)
  })
})

describe('licence override — wins over the env var when non-null', () => {
  it('replaces the env-var result with the licence modules', () => {
    process.env.FEATURE_MODULES_ENABLED = 'A,B,C,D,E'
    setLicenseModules(['A'])
    expect(enabledModules()).toEqual(new Set(['A']))
    expect(isModuleEnabled(['A'])).toBe(true)
    expect(isModuleEnabled(['B'])).toBe(false)
    expect(isModuleEnabled(['C'])).toBe(false)
  })

  it('an empty override means zero modules — unlicensed install denies every gated route', () => {
    process.env.FEATURE_MODULES_ENABLED = 'A,B,C,D,E'
    setLicenseModules([])
    expect(enabledModules().size).toBe(0)
    expect(isModuleEnabled(['A'])).toBe(false)
    expect(isModuleEnabled(['E'])).toBe(false)
    // Routes without a module requirement still pass.
    expect(isModuleEnabled([])).toBe(true)
  })

  it('normalises casing + strips whitespace from the input', () => {
    setLicenseModules([' a ', 'c', 'E'])
    expect(enabledModules()).toEqual(new Set(['A', 'C', 'E']))
  })

  it('silently drops unknown module keys so a forward-compatible JWT still works', () => {
    setLicenseModules(['A', 'FUTURE_MODULE', 'B'])
    expect(enabledModules()).toEqual(new Set(['A', 'B']))
  })

  it('clearing the override (null) falls back to the env var', () => {
    process.env.FEATURE_MODULES_ENABLED = 'A,B'
    setLicenseModules(['E'])
    expect(enabledModules()).toEqual(new Set(['E']))
    setLicenseModules(null)
    expect(enabledModules()).toEqual(new Set(['A', 'B']))
  })

  it('a later override replaces an earlier one (licence re-import)', () => {
    setLicenseModules(['A'])
    expect(enabledModules()).toEqual(new Set(['A']))
    setLicenseModules(['A', 'B', 'C'])
    expect(enabledModules()).toEqual(new Set(['A', 'B', 'C']))
  })
})
