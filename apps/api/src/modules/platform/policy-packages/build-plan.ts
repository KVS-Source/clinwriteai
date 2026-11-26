// The AI build plan of a document type: in which order its sections are drafted, what each one is given from the
// sections drafted before it, and the drafting rules. It comes only from a signed GenBioCa policy package
// (docs/policy-packages.md) and is stored on the document-type policy; the drafting worker follows the version a
// document was created with (apps/worker/src/jobs/build-plan.ts).
//
// Sections are named by their template number and title. Main headings (a number with sub-sections, such as "4")
// keep the template heading and are not drafted.

import { z } from 'zod'

export const BUILD_PLAN_SCHEMA_VERSION = 1

const sectionRef = z.object({
  number: z.string().trim().min(1).max(20),
  title:  z.string().trim().min(1).max(200),
})

const stageSchema = z.object({
  key:   z.string().trim().regex(/^[a-z][a-z0-9_]*$/).max(40),
  label: z.string().trim().min(1).max(120),
  sections: z.array(sectionRef).min(1).max(200),
  rules: z.object({
    /** Example sources may supply wording here (standard text such as ethics). Facts still come only from evidence. */
    exampleWording: z.boolean().optional(),
    /** A summary: only facts already in the sections it depends on, nothing new. */
    noNewFacts:     z.boolean().optional(),
  }).strict().optional(),
}).strict()

export const BUILT_BY_CODE_KINDS = ['references', 'abbreviations', 'toc'] as const

/** Sections a document of this type is expected to have; a template without one gets a warning. */
const expectedSectionSchema = z.object({
  label: z.string().trim().min(1).max(120),
  /** Case-insensitive words, any of which in a template section title counts as having it. */
  matchAny: z.array(z.string().trim().min(2).max(60)).min(1).max(10),
}).strict()

export const buildPlanSchema = z.object({
  schemaVersion: z.literal(BUILD_PLAN_SCHEMA_VERSION),
  docType:       z.string().trim().min(1).max(60),
  label:         z.string().trim().min(1).max(120),
  stages:        z.array(stageSchema).min(1).max(20),
  builtByCode:   z.array(sectionRef.extend({ kind: z.enum(BUILT_BY_CODE_KINDS) }).strict()).max(20).default([]),
  /** Section number → the sections it is given, by number; '*' = every section drafted before it. */
  dependsOn:     z.record(z.union([z.literal('*'), z.array(z.string().trim().min(1).max(20)).max(200)])).default({}),
  expectedSections: z.array(expectedSectionSchema).max(30).default([]),
  /** The study fact sheet extracted at the start of a draft and given to every section (worker fact-sheet.ts). */
  factSheet: z.object({
    fields: z.array(z.object({
      key:   z.string().trim().regex(/^[a-z][a-z0-9_]*$/).max(40),
      label: z.string().trim().min(1).max(80),
      hint:  z.string().trim().max(200).optional(),
    }).strict()).min(1).max(60),
  }).strict().optional(),
  /**
   * Done by code once drafting and checking end (worker finishing.ts): cross-references written as [XREF] markers
   * become section numbers, references written as [REF] markers are found in the evidence, numbered and listed, the
   * abbreviations are checked, and the fact-sheet values are compared across sections.
   */
  finishing: z.object({
    crossReferences: z.boolean().optional(),
    references:      z.boolean().optional(),
    abbreviations:   z.boolean().optional(),
    factConsistency: z.boolean().optional(),
  }).strict().optional(),
  /** Long sources: each section gets only its relevant pages (worker source-pages.ts). */
  sourcePages: z.object({
    /** Up to this many pages in all, every section still gets every file. */
    allBelowPages: z.number().int().min(0).max(5000).default(100),
    /** Text of the chosen pages per section, in characters (about 3.5 per token). */
    budgetChars:   z.number().int().min(10_000).max(400_000).default(80_000),
  }).strict().optional(),
  rules: z.object({
    /** 0 makes drafting as repeatable as the model allows. */
    temperature: z.number().min(0).max(1).optional(),
  }).strict().default({}),
}).strict()

export type BuildPlan = z.infer<typeof buildPlanSchema>

/** A problem that makes the plan unusable. */
export interface PlanError { message: string }

/** Structural rules: every section is placed once, and everything a section depends on is drafted before it. */
export function validateBuildPlan(plan: BuildPlan): PlanError[] {
  const errors: PlanError[] = []
  const position = new Map<string, { stage: number; index: number }>()
  plan.stages.forEach((stage, s) => stage.sections.forEach((sec, i) => {
    if (position.has(sec.number)) errors.push({ message: `Section ${sec.number} is placed more than once.` })
    else position.set(sec.number, { stage: s, index: i })
  }))
  const stageKeys = plan.stages.map(s => s.key)
  for (const key of new Set(stageKeys)) {
    if (stageKeys.filter(k => k === key).length > 1) errors.push({ message: `Stage "${key}" appears more than once.` })
  }
  const codeBuilt = new Set<string>()
  for (const sec of plan.builtByCode) {
    if (position.has(sec.number) || codeBuilt.has(sec.number)) errors.push({ message: `Section ${sec.number} is placed more than once.` })
    codeBuilt.add(sec.number)
  }
  for (const [number, deps] of Object.entries(plan.dependsOn)) {
    const at = position.get(number)
    if (!at) {
      errors.push({ message: `dependsOn names section ${number}, which no stage drafts.` })
      continue
    }
    if (deps === '*') continue
    for (const dep of deps) {
      const d = position.get(dep)
      if (dep === number) errors.push({ message: `Section ${number} depends on itself.` })
      else if (codeBuilt.has(dep)) errors.push({ message: `Section ${number} depends on ${dep}, which is built by code after drafting.` })
      else if (!d) errors.push({ message: `Section ${number} depends on ${dep}, which no stage drafts.` })
      else if (d.stage > at.stage || (d.stage === at.stage && d.index > at.index)) {
        errors.push({ message: `Section ${number} depends on ${dep}, which is drafted after it.` })
      }
    }
  }
  const keys = (plan.factSheet?.fields ?? []).map(f => f.key)
  for (const key of new Set(keys)) {
    if (keys.filter(k => k === key).length > 1) errors.push({ message: `Fact "${key}" appears more than once in the fact sheet.` })
  }
  return errors
}

export interface TemplateSection { number: string; title: string }

/** A number with sub-sections ("4" when "4.1" exists): a main heading, kept as in the template and not drafted. */
export function headingNumbers(sections: TemplateSection[]): Set<string> {
  const numbers = sections.map(s => s.number.trim())
  return new Set(numbers.filter(n => numbers.some(m => m.startsWith(`${n}.`))))
}

const sameTitle = (a: string, b: string) => a.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim() === b.toLowerCase().replace(/[^a-z0-9]+/g, ' ').trim()

/** How the plan fits a template. Warnings only: whatever doesn't fit is drafted in a default stage or skipped. */
export function checkPlanAgainstTemplate(plan: BuildPlan, sections: TemplateSection[]): string[] {
  const warnings: string[] = []
  const byNumber = new Map(sections.map(s => [s.number.trim(), s]))
  const headings = headingNumbers(sections)
  const planned = [...plan.stages.flatMap(s => s.sections), ...plan.builtByCode]
  const plannedNumbers = new Set(planned.map(s => s.number))

  for (const p of planned) {
    const t = byNumber.get(p.number)
    if (!t) warnings.push(`The plan drafts ${p.number} ${p.title}, but the template has no section ${p.number}. It will be skipped.`)
    else if (!sameTitle(t.title, p.title)) warnings.push(`Section ${p.number} is “${t.title}” in the template but “${p.title}” in the plan. Check that the plan still fits.`)
    else if (headings.has(p.number)) warnings.push(`The plan drafts ${p.number} ${p.title}, but it is a main heading in the template, so it keeps the heading only.`)
  }
  for (const t of sections) {
    const n = t.number.trim()
    if (!plannedNumbers.has(n) && !headings.has(n)) {
      warnings.push(`${n} ${t.title} is not in the build plan. It will be drafted after the plan’s stages, before the summary.`)
    }
  }
  for (const e of plan.expectedSections) {
    const words = e.matchAny.map(w => w.toLowerCase())
    if (!sections.some(s => words.some(w => s.title.toLowerCase().includes(w)))) {
      warnings.push(`The template has no ${e.label} section.`)
    }
  }
  return warnings
}

/** Parses and validates a plan; the errors say why it can't be used. */
export function parseBuildPlan(raw: unknown): { ok: true; plan: BuildPlan } | { ok: false; errors: string[] } {
  const parsed = buildPlanSchema.safeParse(raw)
  if (!parsed.success) {
    return { ok: false, errors: parsed.error.issues.map(i => `${i.path.join('.') || 'plan'}: ${i.message}`) }
  }
  const errors = validateBuildPlan(parsed.data)
  return errors.length ? { ok: false, errors: errors.map(e => e.message) } : { ok: true, plan: parsed.data }
}

/** Section numbers a plan keeps out of AI drafting: main headings and code-built sections. Empty without a plan. */
export function numbersNotDraftedByAi(rawPlan: unknown, numbers: string[]): Set<string> {
  if (rawPlan == null || typeof rawPlan !== 'object') return new Set()
  // Read loosely (like the worker): a stored plan was validated when it was imported.
  const built = (rawPlan as { builtByCode?: unknown }).builtByCode
  const codeBuilt = Array.isArray(built) ? built.flatMap(b => (b && typeof (b as { number?: unknown }).number === 'string' ? [(b as { number: string }).number] : [])) : []
  return new Set([...headingNumbers(numbers.map(number => ({ number, title: '' }))), ...codeBuilt])
}
