// Business-module kill-switch, web side. Mirrors the API's
// FEATURE_MODULES_ENABLED env — see docs/pivot-plan.md Arc 1.
//
// Post 2026-10-06 pivot the demo + dev builds ship with 'A' only
// (Clinical Writing). Deep links to disabled modules land on
// <ModuleDisabledScreen /> instead of a half-wired page.

export type ModuleKey = 'A' | 'B' | 'C' | 'D' | 'E'

export type ModuleSlug =
  | 'clinical-writing'
  | 'scientific-writing'
  | 'medical-writing'
  | 'regulatory-writing'
  | 'ideation-publishing'

export const MODULE_SLUG_TO_KEY: Record<ModuleSlug, ModuleKey> = {
  'clinical-writing':    'A',
  'scientific-writing':  'B',
  'medical-writing':     'C',
  'regulatory-writing':  'D',
  'ideation-publishing': 'E',
}

export const MODULE_LABELS: Record<ModuleSlug, string> = {
  'clinical-writing':    'Clinical Writing',
  'scientific-writing':  'Scientific Writing',
  'medical-writing':     'Medical Writing',
  'regulatory-writing':  'Regulatory Writing',
  'ideation-publishing': 'Ideation & Publishing',
}

function parseEnabled(): Set<ModuleKey> {
  const raw = (import.meta.env.VITE_MODULES_ENABLED as string | undefined) ?? 'A'
  const parsed = raw
    .split(',')
    .map(s => s.trim().toUpperCase())
    .filter((s): s is ModuleKey => (['A', 'B', 'C', 'D', 'E'] as const).includes(s as ModuleKey))
  return new Set(parsed.length > 0 ? parsed : ['A'])
}

const ENABLED = parseEnabled()

export function enabledModules(): ReadonlySet<ModuleKey> {
  return ENABLED
}

export function isModuleEnabled(key: ModuleKey): boolean {
  return ENABLED.has(key)
}

export function isModuleSlugEnabled(slug: string): boolean {
  const key = MODULE_SLUG_TO_KEY[slug as ModuleSlug]
  return key ? isModuleEnabled(key) : false
}
