// AI engine settings (Admin Panel -> AI Engine, PRD sPM04 / AC-PM-001):
//   default engine, fallback engine, and whether modules may override the engine.
//
// Storage: there is no settings table yet, so each Save is written to the
// tamper-evident audit trail as an `ai_engine_config_saved` event (with the value
// it replaced) and the current setting is the most recent such event. That keeps
// the PRD's "every change is written to the audit trail" true by construction.
// When a settings table exists, only load/save here need to change.

import type { PrismaClient } from '@prisma/client'

export const AI_ENGINE_SAVED = 'ai_engine_config_saved'

export interface AiEngineSettings {
  default:                  string
  fallback:                 string
  perModuleOverrideEnabled: boolean
}

export interface AiEngineOption { id: string; label: string; provider: string }

/** The engines this deployment can route to (model ids come from env, with defaults). */
export function availableEngineOptions(env: NodeJS.ProcessEnv = process.env): AiEngineOption[] {
  const sonnet = env.ANTHROPIC_MODEL_SONNET || 'claude-sonnet-4-6'
  const opus   = env.ANTHROPIC_MODEL_OPUS   || 'claude-opus-4-7'
  const haiku  = env.ANTHROPIC_MODEL_HAIKU  || 'claude-haiku-4-5'
  return [
    { id: sonnet, label: sonnet, provider: 'Anthropic' },
    { id: opus,   label: opus,   provider: 'Anthropic' },
    { id: haiku,  label: haiku,  provider: 'Anthropic' },
  ]
}

/** What applies when nothing has been saved: the env-configured models. */
export function defaultEngineSettings(env: NodeJS.ProcessEnv = process.env): AiEngineSettings {
  const [sonnet, , haiku] = availableEngineOptions(env)
  return { default: sonnet!.id, fallback: haiku!.id, perModuleOverrideEnabled: true }
}

const isSettings = (v: unknown): v is AiEngineSettings =>
  !!v && typeof v === 'object'
  && typeof (v as AiEngineSettings).default === 'string'
  && typeof (v as AiEngineSettings).fallback === 'string'
  && typeof (v as AiEngineSettings).perModuleOverrideEnabled === 'boolean'

/** The most recently saved settings, or null if none were ever saved. */
export async function loadSavedAiEngineSettings(prisma: PrismaClient): Promise<AiEngineSettings | null> {
  try {
    const rows = await prisma.$queryRaw<Array<{ details: Record<string, unknown> | null }>>`
      SELECT details FROM audit_events WHERE action = ${AI_ENGINE_SAVED} ORDER BY id DESC LIMIT 1
    `
    const d = rows[0]?.details
    if (!d) return null
    const saved = { default: d.default, fallback: d.fallback, perModuleOverrideEnabled: d.perModuleOverrideEnabled }
    return isSettings(saved) ? saved : null
  } catch { return null }          // an unreadable audit row must never break AI calls or the Admin Panel
}

/** Effective settings: the saved ones if they still name a known engine, else the env defaults. */
export async function resolveAiEngineSettings(prisma: PrismaClient, env: NodeJS.ProcessEnv = process.env): Promise<AiEngineSettings> {
  const base = defaultEngineSettings(env)
  const saved = await loadSavedAiEngineSettings(prisma)
  if (!saved) return base
  const ids = new Set(availableEngineOptions(env).map(e => e.id))
  return {
    default:  ids.has(saved.default)  ? saved.default  : base.default,
    fallback: ids.has(saved.fallback) ? saved.fallback : base.fallback,
    perModuleOverrideEnabled: saved.perModuleOverrideEnabled,
  }
}

/**
 * The model an AI call should use. With per-module override on, a caller may ask
 * for a specific engine; with it off (or no request), the saved default applies.
 * "All subsequent AI calls use the selected engine until changed" (AC-PM-001).
 */
export async function chooseModel(prisma: PrismaClient, requested?: string | null, env: NodeJS.ProcessEnv = process.env): Promise<string> {
  const settings = await resolveAiEngineSettings(prisma, env)
  return requested && settings.perModuleOverrideEnabled ? requested : settings.default
}

/** Validation for a Save: both engines must be known, and the fallback must differ from the default. */
export function validateAiEngineSettings(input: AiEngineSettings, env: NodeJS.ProcessEnv = process.env): string | null {
  const ids = new Set(availableEngineOptions(env).map(e => e.id))
  if (!ids.has(input.default))  return `"${input.default}" is not an available engine.`
  if (!ids.has(input.fallback)) return `"${input.fallback}" is not an available engine.`
  if (input.default === input.fallback) return 'The fallback engine must be different from the default engine.'
  return null
}
