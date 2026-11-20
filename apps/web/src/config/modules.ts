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

// Reverse of MODULE_SLUG_TO_KEY. Needed because the API returns
// `activeModules` as ModuleKey[] but most of the client UI expects
// slugs (route segments, meta lookups).
export const MODULE_KEY_TO_SLUG: Record<ModuleKey, ModuleSlug> = {
  A: 'clinical-writing',
  B: 'scientific-writing',
  C: 'medical-writing',
  D: 'regulatory-writing',
  E: 'ideation-publishing',
}

export const MODULE_LABELS: Record<ModuleSlug, string> = {
  'clinical-writing':    'Clinical Writing',
  'scientific-writing':  'Scientific Writing',
  'medical-writing':     'Medical Writing',
  'regulatory-writing':  'Regulatory Writing',
  'ideation-publishing': 'Ideation & Publishing',
}

// Short monogram shown on chips + the collapsed sidebar rail. Writers never
// see the raw module LETTER (A/B/C/D/E) — always the human abbreviation.
export const MODULE_MONOGRAMS: Record<ModuleSlug, string> = {
  'clinical-writing':    'CW',
  'scientific-writing':  'SW',
  'medical-writing':     'MW',
  'regulatory-writing':  'RW',
  'ideation-publishing': 'IP',
}

// Accent colour per module — design-system Decision 10. Reused by the
// Sidebar module rail, the count chips on the Projects list, and anywhere
// else UI needs to differentiate modules at a glance.
export const MODULE_COLOURS: Record<ModuleSlug, string> = {
  'clinical-writing':    '#2563EB',    // blue
  'scientific-writing':  '#0D9488',    // teal
  'medical-writing':     '#7C3AED',    // purple
  'regulatory-writing':  '#B0200D',    // red
  'ideation-publishing': '#D97706',    // amber (disambiguated from SW's teal)
}

// Key → display label. Mirrors MODULE_LABELS keyed by the single-letter
// identifier that appears in API payloads and filter UI.
export const MODULE_KEY_TO_LABEL: Record<ModuleKey, string> = {
  A: 'Clinical Writing',
  B: 'Scientific Writing',
  C: 'Medical Writing',
  D: 'Regulatory Writing',
  E: 'Ideation & Publishing',
}

/** Env-var fallback (dev / CI / fixture load before /auth/me returns).
 *  Production reads from the licence (via the platformStore, populated
 *  from /auth/me — see `licenseModulesOverride` below). */
function parseEnabledFromEnv(): Set<ModuleKey> {
  const raw = (import.meta.env.VITE_MODULES_ENABLED as string | undefined) ?? 'A'
  const parsed = raw
    .split(',')
    .map(s => s.trim().toUpperCase())
    .filter((s): s is ModuleKey => (['A', 'B', 'C', 'D', 'E'] as const).includes(s as ModuleKey))
  return new Set(parsed.length > 0 ? parsed : ['A'])
}

const ENV_FALLBACK = parseEnabledFromEnv()

/** Licence-driven override. Set by the platform store on the first
 *  /auth/me response that carries `enabledModules`. When set, it wins
 *  over the env fallback. Null means "/auth/me hasn't landed yet".
 *
 *  Module imports are evaluated once at startup; sidebar gating runs
 *  on every render so the switch takes effect as soon as the store
 *  updates the override. */
let licenseModulesOverride: Set<ModuleKey> | null = null

/** Called by the platform store when /auth/me returns. Pass null to
 *  clear (test teardown). */
export function setLicenseModulesOverride(modules: ReadonlyArray<string> | null): void {
  if (modules === null) {
    licenseModulesOverride = null
    return
  }
  const narrowed = modules
    .map(s => s.trim().toUpperCase())
    .filter((s): s is ModuleKey => (['A', 'B', 'C', 'D', 'E'] as const).includes(s as ModuleKey))
  licenseModulesOverride = new Set(narrowed)
}

export function enabledModules(): ReadonlySet<ModuleKey> {
  return licenseModulesOverride ?? ENV_FALLBACK
}

export function isModuleEnabled(key: ModuleKey): boolean {
  return enabledModules().has(key)
}

export function isModuleSlugEnabled(slug: string): boolean {
  const key = MODULE_SLUG_TO_KEY[slug as ModuleSlug]
  return key ? isModuleEnabled(key) : false
}
