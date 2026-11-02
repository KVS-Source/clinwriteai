#!/usr/bin/env tsx
/**
 * translate-missing-keys.ts — dev-time i18n translator (Phase 1, 2026-11-03).
 *
 * Reads apps/web/src/i18n/en.json, finds any keys missing (or empty) in
 * the target language file, routes each missing string through the engine
 * registered for that language, writes the result back. The operator
 * reviews the diff + commits.
 *
 * NEVER runs at request time. No translator API key ever leaves a
 * developer's machine. The target JSON files are checked into git and
 * shipped as part of the Vite bundle.
 *
 * Usage:
 *   npm --workspace=apps/web run translate -- --target ja
 *   npm --workspace=apps/web run translate -- --target ja --engine google
 *   npm --workspace=apps/web run translate -- --target hi --dry-run
 *   npm --workspace=apps/web run translate -- --help
 *
 * Engine routes (pick is overridable with --engine):
 *   ja → Claude (via ANTHROPIC_API_KEY), fallback Google (GOOGLE_TRANSLATE_API_KEY)
 *   hi / ta / te / bn / mr / gu / kn / ml / pa / ur / as / or → Bhashini (stub for now)
 *   anything else → Claude
 *
 * Add a new language: drop a `<code>.json` file alongside `en.json` + `ja.json`
 * (empty `{}` is fine — the script populates it), add the code to the routes
 * table below if it needs a non-default engine, and run with --target <code>.
 */

import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const I18N_DIR = resolve(__dirname, '..', 'src', 'i18n')
const EN_PATH  = resolve(I18N_DIR, 'en.json')

type Engine = 'claude' | 'google' | 'bhashini' | 'stub'

interface Options {
  target:  string
  engine?: Engine
  dryRun:  boolean
}

/** Per-language default engine. --engine overrides. */
const ROUTES: Readonly<Record<string, Engine>> = {
  ja: 'claude',
  hi: 'bhashini', ta: 'bhashini', te: 'bhashini', bn: 'bhashini',
  mr: 'bhashini', gu: 'bhashini', kn: 'bhashini', ml: 'bhashini',
  pa: 'bhashini', ur: 'bhashini', as: 'bhashini', or: 'bhashini',
}

/** Human names for the engines — used in log output. */
const ENGINE_LABEL: Record<Engine, string> = {
  claude:   'Claude (via ANTHROPIC_API_KEY)',
  google:   'Google Translate (via GOOGLE_TRANSLATE_API_KEY)',
  bhashini: 'Bhashini (ULCA; India languages only)',
  stub:     '[stub] placeholder translator',
}

// Human-readable target-language names so Claude knows what to translate TO.
const LANG_NAME: Record<string, string> = {
  ja: 'Japanese',
  hi: 'Hindi', ta: 'Tamil', te: 'Telugu', bn: 'Bengali',
  mr: 'Marathi', gu: 'Gujarati', kn: 'Kannada', ml: 'Malayalam',
  pa: 'Punjabi', ur: 'Urdu', as: 'Assamese', or: 'Odia',
  es: 'Spanish', fr: 'French', de: 'German',
}

function parseArgs(argv: string[]): Options {
  let target: string | undefined
  let engine: Engine | undefined
  let dryRun = false
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    switch (a) {
      case '--target': target = argv[++i]; break
      case '--engine': engine = argv[++i] as Engine; break
      case '--dry-run': dryRun = true; break
      case '--help': case '-h': printHelp(); process.exit(0)
      default: exitErr(`unknown flag: ${a}`)
    }
  }
  if (!target) exitErr('--target <lang> is required (e.g. --target ja)')
  if (engine && !(['claude','google','bhashini','stub'] as const).includes(engine)) {
    exitErr(`--engine must be one of: claude, google, bhashini, stub`)
  }
  return { target: target!, engine, dryRun }
}

function printHelp(): void {
  process.stdout.write(`
Usage: npm --workspace=apps/web run translate -- --target <lang> [flags]

Flags:
  --target <code>   Target language code (e.g. ja, hi, ta). Required.
  --engine <name>   Override the default engine: claude | google | bhashini | stub
  --dry-run         Report what WOULD be translated; no writes.
  --help, -h        Show this message.

Default engine by language:
  ja              -> claude (fallback: google)
  hi/ta/te/bn/mr/gu/kn/ml/pa/ur/as/or -> bhashini
  everything else -> claude

Env vars (set in your local shell or apps/api/.env.local; NEVER on the VPS):
  ANTHROPIC_API_KEY           Claude engine
  GOOGLE_TRANSLATE_API_KEY    Google engine
  BHASHINI_* (TBD when first Indian customer signs; currently stubbed)

`)
}

function exitErr(msg: string): never {
  process.stderr.write(`translate-missing-keys: ${msg}\n`)
  process.exit(2)
}

// ────────────────────────────────────────────────────────────────────────
// Flatten + un-flatten utilities. The JSON files are nested
// ("button.save") but the translator operates on flat key→string maps.

type FlatMap = Record<string, string>

function flatten(obj: unknown, prefix = ''): FlatMap {
  const out: FlatMap = {}
  if (obj === null || typeof obj !== 'object') return out
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    const key = prefix ? `${prefix}.${k}` : k
    if (v && typeof v === 'object' && !Array.isArray(v)) {
      Object.assign(out, flatten(v, key))
    } else if (typeof v === 'string') {
      out[key] = v
    }
  }
  return out
}

function unflatten(flat: FlatMap): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const [key, val] of Object.entries(flat)) {
    const parts = key.split('.')
    let cur: Record<string, unknown> = out
    for (let i = 0; i < parts.length - 1; i++) {
      const p = parts[i]!
      if (typeof cur[p] !== 'object' || cur[p] === null) cur[p] = {}
      cur = cur[p] as Record<string, unknown>
    }
    cur[parts[parts.length - 1]!] = val
  }
  return out
}

// ────────────────────────────────────────────────────────────────────────
// Engine implementations. Each takes a batch of EN strings + the target
// language code and returns the same-shape batch of translated strings.
//
// IMPORTANT: these run on the dev machine ONLY. The web app bundle never
// imports from this file — Vite's input is apps/web/src/*, not scripts/*.

async function translateWithClaude(batch: string[], target: string): Promise<string[]> {
  const apiKey = process.env.ANTHROPIC_API_KEY?.trim()
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY is not set')
  const langName = LANG_NAME[target] ?? target

  // Single call with the whole batch as a numbered list. Claude returns a
  // numbered list in the target language; we parse it back out. The system
  // prompt tells Claude we're localising UI chrome for regulated clinical
  // writing software — biases towards technical / formal register.
  const { default: Anthropic } = await import('@anthropic-ai/sdk')
  const client = new Anthropic({ apiKey })

  const system = [
    `You are translating UI chrome strings for ClinWrite.AI, a regulated clinical writing SaaS used by pharmaceutical companies.`,
    `Target language: ${langName}.`,
    `Register: formal, technical, concise. Match the tone of enterprise software for medical / regulatory professionals.`,
    `Preserve: placeholders in {{curly}}, HTML tags, punctuation, trailing ellipses, and the ... character.`,
    `Return ONLY a JSON array of strings, same length and order as the input array. No prose, no code fences.`,
  ].join('\n')

  const userPrompt = `Translate each string to ${langName}:\n${JSON.stringify(batch)}`

  const message = await client.messages.create({
    model:      process.env.ANTHROPIC_DRAFT_MODEL?.trim() || 'claude-sonnet-4-6',
    max_tokens: 4096,
    system,
    messages: [{ role: 'user', content: userPrompt }],
  })

  const text = message.content
    .map(b => (b.type === 'text' ? (b as { type: 'text'; text: string }).text : ''))
    .join('\n')
    .trim()

  const stripped = text.replace(/^\s*```[a-z]*\s*\n?/, '').replace(/\n?\s*```\s*$/, '').trim()
  const parsed = JSON.parse(stripped) as unknown
  if (!Array.isArray(parsed)) throw new Error('Claude returned a non-array response')
  if (parsed.length !== batch.length) {
    throw new Error(`Claude returned ${parsed.length} strings, expected ${batch.length}`)
  }
  return parsed.map(v => (typeof v === 'string' ? v : String(v)))
}

async function translateWithGoogle(batch: string[], target: string): Promise<string[]> {
  const apiKey = process.env.GOOGLE_TRANSLATE_API_KEY?.trim()
  if (!apiKey) throw new Error('GOOGLE_TRANSLATE_API_KEY is not set')

  // v2 REST — simplest API shape. Batches up to 128 strings per call per
  // Google's docs; our bundles are nowhere near that. Source language is
  // auto-detected but we pin 'en' for determinism.
  const url = `https://translation.googleapis.com/language/translate/v2?key=${encodeURIComponent(apiKey)}`
  const body = { q: batch, source: 'en', target, format: 'text' }
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    throw new Error(`Google Translate HTTP ${res.status}: ${await res.text()}`)
  }
  const json = await res.json() as { data?: { translations?: Array<{ translatedText: string }> } }
  const items = json.data?.translations ?? []
  if (items.length !== batch.length) {
    throw new Error(`Google returned ${items.length} translations, expected ${batch.length}`)
  }
  return items.map(t => t.translatedText)
}

async function translateWithBhashini(batch: string[], target: string): Promise<string[]> {
  // Stub for now. Bhashini wiring lands when the first Indian customer
  // signs — then we register ULCA pipeline IDs + model keys per target
  // language and swap the body of this function.
  //
  // Reminder: Bhashini covers all 22 scheduled Indian languages
  // (hi / ta / te / bn / mr / gu / kn / ml / pa / ur / as / or) but has
  // NO Japanese support — don't route ja here.
  throw new Error(
    `Bhashini translator is not wired yet (stub). Use --engine claude for now ` +
    `(translating to ${target}), or install the Bhashini pipeline when the ` +
    `first Indian customer signs. See memory/project_i18n_phase1.md.`
  )
}

async function translateWithStub(batch: string[], target: string): Promise<string[]> {
  // Deterministic placeholder — lets you walk the end-to-end pipeline
  // without any API key. Human replaces output before shipping.
  return batch.map(s => `[${target}] ${s}`)
}

async function translate(batch: string[], target: string, engine: Engine): Promise<string[]> {
  switch (engine) {
    case 'claude':   return translateWithClaude(batch, target)
    case 'google':   return translateWithGoogle(batch, target)
    case 'bhashini': return translateWithBhashini(batch, target)
    case 'stub':     return translateWithStub(batch, target)
  }
}

// ────────────────────────────────────────────────────────────────────────
// Main

async function main() {
  const opts = parseArgs(process.argv.slice(2))
  const targetPath = resolve(I18N_DIR, `${opts.target}.json`)

  if (!existsSync(EN_PATH)) exitErr(`en.json not found at ${EN_PATH}`)
  if (!existsSync(targetPath)) {
    process.stdout.write(`[info] ${opts.target}.json does not exist yet — will create it.\n`)
    writeFileSync(targetPath, '{}\n', 'utf8')
  }

  const en = JSON.parse(readFileSync(EN_PATH, 'utf8'))
  const existing = JSON.parse(readFileSync(targetPath, 'utf8'))
  const enFlat = flatten(en)
  const existingFlat = flatten(existing)

  // "Missing" = key not in target, or value is empty/whitespace. We DO
  // NOT re-translate strings the operator already wrote — those are
  // human-reviewed; respect them.
  const missingKeys = Object.keys(enFlat).filter(k =>
    !(k in existingFlat) || existingFlat[k]!.trim().length === 0
  )

  process.stdout.write(
    `\n[info] target=${opts.target}  engine=${opts.engine ?? ROUTES[opts.target] ?? 'claude'}\n` +
    `[info] ${Object.keys(enFlat).length} total keys · ${missingKeys.length} missing in ${opts.target}.json\n`
  )

  if (missingKeys.length === 0) {
    process.stdout.write(`[info] Nothing to translate. Exit.\n\n`)
    return
  }

  if (opts.dryRun) {
    process.stdout.write(`\n[dry-run] Would translate:\n`)
    for (const k of missingKeys) process.stdout.write(`  ${k}  →  ${JSON.stringify(enFlat[k])}\n`)
    process.stdout.write(`\n`)
    return
  }

  const engine: Engine = opts.engine ?? ROUTES[opts.target] ?? 'claude'
  process.stdout.write(`[info] engine → ${ENGINE_LABEL[engine]}\n[info] translating ${missingKeys.length} strings…\n`)

  const batch = missingKeys.map(k => enFlat[k]!)
  const translated = await translate(batch, opts.target, engine)

  // Merge: start from the existing (preserve human edits), overlay translated.
  const merged: FlatMap = { ...existingFlat }
  for (let i = 0; i < missingKeys.length; i++) {
    merged[missingKeys[i]!] = translated[i]!
  }

  const outObj = unflatten(merged)
  writeFileSync(targetPath, JSON.stringify(outObj, null, 2) + '\n', 'utf8')
  process.stdout.write(
    `\n[ok] wrote ${missingKeys.length} new keys to ${opts.target}.json\n` +
    `     review the diff before committing — translator output is a draft, not final.\n\n`
  )
}

main().catch(err => {
  process.stderr.write(`\ntranslate-missing-keys: ${err instanceof Error ? err.message : String(err)}\n`)
  process.exitCode = 1
})
