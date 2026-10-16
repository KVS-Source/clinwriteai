import { describe, expect, it, vi } from 'vitest'
import type { PrismaClient } from '@prisma/client'
import {
  availableEngineOptions, chooseModel, defaultEngineSettings, loadSavedAiEngineSettings,
  resolveAiEngineSettings, validateAiEngineSettings,
} from './ai-engine-settings.js'

const ENV = { ANTHROPIC_MODEL_SONNET: 'son', ANTHROPIC_MODEL_OPUS: 'opu', ANTHROPIC_MODEL_HAIKU: 'hai' } as NodeJS.ProcessEnv
const prismaWith = (details: Record<string, unknown> | null | 'throw') =>
  ({ $queryRaw: vi.fn(async () => { if (details === 'throw') throw new Error('db'); return details ? [{ details }] : [] }) }) as unknown as PrismaClient

describe('engines + defaults', () => {
  it('lists the three Anthropic engines from env, with built-in fallbacks', () => {
    expect(availableEngineOptions(ENV).map(e => e.id)).toEqual(['son', 'opu', 'hai'])
    expect(availableEngineOptions({} as NodeJS.ProcessEnv).map(e => e.id)).toEqual(['claude-sonnet-4-6', 'claude-opus-4-7', 'claude-haiku-4-5'])
  })
  it('defaults to Sonnet with Haiku as fallback and overrides allowed', () => {
    expect(defaultEngineSettings(ENV)).toEqual({ default: 'son', fallback: 'hai', perModuleOverrideEnabled: true })
  })
})

describe('resolveAiEngineSettings', () => {
  it('uses the env defaults when nothing was saved', async () => {
    expect(await resolveAiEngineSettings(prismaWith(null), ENV)).toEqual(defaultEngineSettings(ENV))
  })
  it('uses the most recently saved settings', async () => {
    const saved = { default: 'opu', fallback: 'son', perModuleOverrideEnabled: false }
    expect(await resolveAiEngineSettings(prismaWith({ ...saved, previous: {} }), ENV)).toEqual(saved)
  })
  it('ignores a saved engine that no longer exists and survives a db error or a malformed row', async () => {
    expect(await resolveAiEngineSettings(prismaWith({ default: 'gone', fallback: 'hai', perModuleOverrideEnabled: true }), ENV))
      .toEqual({ default: 'son', fallback: 'hai', perModuleOverrideEnabled: true })
    expect(await resolveAiEngineSettings(prismaWith('throw'), ENV)).toEqual(defaultEngineSettings(ENV))
    expect(await loadSavedAiEngineSettings(prismaWith({ default: 1 }))).toBeNull()
  })
})

describe('chooseModel (all AI calls use the saved engine until changed)', () => {
  const saved = (over = {}) => prismaWith({ default: 'opu', fallback: 'hai', perModuleOverrideEnabled: true, ...over })
  it('uses the saved default when the caller names no engine', async () => expect(await chooseModel(saved(), undefined, ENV)).toBe('opu'))
  it('lets a caller pick an engine while per-module override is allowed', async () => expect(await chooseModel(saved(), 'hai', ENV)).toBe('hai'))
  it('ignores the caller\'s engine once override is switched off', async () => expect(await chooseModel(saved({ perModuleOverrideEnabled: false }), 'hai', ENV)).toBe('opu'))
})

describe('validateAiEngineSettings', () => {
  const ok = { default: 'opu', fallback: 'hai', perModuleOverrideEnabled: true }
  it('accepts two different known engines', () => expect(validateAiEngineSettings(ok, ENV)).toBeNull())
  it('rejects unknown engines and a fallback equal to the default', () => {
    expect(validateAiEngineSettings({ ...ok, default: 'gpt-4o' }, ENV)).toMatch(/not an available engine/)
    expect(validateAiEngineSettings({ ...ok, fallback: 'nope' }, ENV)).toMatch(/not an available engine/)
    expect(validateAiEngineSettings({ ...ok, fallback: 'opu' }, ENV)).toMatch(/must be different/)
  })
})
