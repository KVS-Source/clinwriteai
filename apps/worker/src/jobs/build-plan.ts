// Following a document type's AI build plan while drafting (the plan itself: apps/api/.../policy-packages/build-plan.ts,
// docs/policy-packages.md).
//
// The plan comes from the policy version the document was created with, so a later import never changes a draft
// already under way. Without a plan the document drafts as before: template order, every section, nothing shared.
//
// With a plan:
//   - sections are drafted stage by stage, in the plan's order;
//   - main headings (a number with sub-sections) keep the template heading and are not drafted;
//   - sections built by code (references) are left for code;
//   - template sections the plan doesn't place are drafted after its stages, before a summary stage;
//   - each section is given the already-drafted sections it depends on, so facts stay the same across the document.

export interface PlanSectionRef { number: string; title: string }

export interface BuildPlanForDraft {
  label:       string
  stages:      Array<{ key: string; label: string; sections: PlanSectionRef[]; rules?: { exampleWording?: boolean; noNewFacts?: boolean } }>
  builtByCode: Array<PlanSectionRef & { kind: string }>
  dependsOn:   Record<string, '*' | string[]>
  /** temperature is not sent: the API version the SDK uses rejects sampling parameters (it would fail every call). */
  rules:       { temperature?: number }
  factSheet?:  { fields: Array<{ key: string; label: string; hint?: string }> }
  sourcePages?: { allBelowPages: number; budgetChars: number }
  finishing?:  { crossReferences?: boolean; references?: boolean; abbreviations?: boolean; factConsistency?: boolean }
  /** Main headings: 'template_only' keeps the template heading; 'lead_in' drafts an introduction after its sub-sections. */
  headings?:   'template_only' | 'lead_in'
}

export interface PlannedSection<S> {
  section:    S
  stageKey:   string
  stageLabel: string
  /** draft = the AI writes it; heading = kept as in the template; code = built by code after drafting. */
  mode:       'draft' | 'heading' | 'code'
  /** Numbers of the sections it is given; '*' = every section drafted before it. */
  dependsOn:  '*' | string[]
  /** sectionIntro: a main heading's introduction, written from its own sub-sections (plan headings: 'lead_in'). */
  rules:      { exampleWording?: boolean; noNewFacts?: boolean; sectionIntro?: boolean }
}

const UNPLANNED = { key: 'unplanned', label: 'Sections not in the plan' }

/** The loose shape check the worker needs; the API validated the plan in full when it was imported. */
export function asBuildPlan(raw: unknown): BuildPlanForDraft | null {
  const p = raw as Partial<BuildPlanForDraft> | null
  if (!p || typeof p !== 'object' || !Array.isArray(p.stages) || p.stages.length === 0) return null
  return {
    label: typeof p.label === 'string' ? p.label : 'Build plan',
    stages: p.stages,
    builtByCode: Array.isArray(p.builtByCode) ? p.builtByCode : [],
    dependsOn: p.dependsOn && typeof p.dependsOn === 'object' ? p.dependsOn : {},
    rules: p.rules && typeof p.rules === 'object' ? p.rules : {},
    ...(p.factSheet && Array.isArray(p.factSheet.fields) && p.factSheet.fields.length ? { factSheet: p.factSheet } : {}),
    ...(p.finishing && typeof p.finishing === 'object' ? { finishing: p.finishing } : {}),
    ...(p.headings === 'lead_in' ? { headings: 'lead_in' as const } : {}),
    ...(p.sourcePages ? { sourcePages: { allBelowPages: p.sourcePages.allBelowPages ?? 100, budgetChars: p.sourcePages.budgetChars ?? 80_000 } } : {}),
  }
}

/** A number with sub-sections ("4" when "4.1" exists). Same rule as the API's headingNumbers. */
export function headingNumbers(numbers: string[]): Set<string> {
  const all = numbers.map(n => n.trim())
  return new Set(all.filter(n => all.some(m => m.startsWith(`${n}.`))))
}

/** The template's sections in the order the plan drafts them, each with what it is given. */
export function orderByPlan<S extends { number: string; title: string }>(sections: S[], plan: BuildPlanForDraft): Array<PlannedSection<S>> {
  const byNumber = new Map(sections.map(s => [s.number.trim(), s]))
  const headings = headingNumbers(sections.map(s => s.number))
  const codeBuilt = new Set(plan.builtByCode.map(s => s.number))
  const out: Array<PlannedSection<S>> = []
  const placed = new Set<string>()
  const draft = (s: S, stage: { key: string; label: string }, rules: PlannedSection<S>['rules']) => {
    placed.add(s.number.trim())
    out.push({ section: s, stageKey: stage.key, stageLabel: stage.label, mode: 'draft', dependsOn: plan.dependsOn[s.number.trim()] ?? [], rules })
  }

  const unplanned = sections.filter(s => {
    const n = s.number.trim()
    return !headings.has(n) && !codeBuilt.has(n) && !plan.stages.some(st => st.sections.some(p => p.number === n))
  })
  // Sections the plan doesn't place go after its stages, but before a summary (which must see them).
  const summaryAt = plan.stages.findIndex(st => st.rules?.noNewFacts)
  plan.stages.forEach((stage, i) => {
    if (i === summaryAt) for (const s of unplanned) draft(s, UNPLANNED, {})
    for (const ref of stage.sections) {
      const s = byNumber.get(ref.number)
      if (s && !headings.has(ref.number) && !placed.has(ref.number)) draft(s, stage, stage.rules ?? {})
    }
  })
  if (summaryAt < 0) for (const s of unplanned) draft(s, UNPLANNED, {})

  // Main headings as introductions: each right after the last of its own sub-sections, deepest first (so "7" comes
  // after "7.1" when 7.1 has sub-sections of its own), given those sub-sections and adding no new facts.
  if (plan.headings === 'lead_in') {
    const byDepth = [...headings].sort((a, b) => b.split('.').length - a.split('.').length)
    for (const n of byDepth) {
      const s = byNumber.get(n)
      if (!s || codeBuilt.has(n)) continue
      const children = out.map((p, i) => ({ p, i })).filter(({ p }) => p.mode === 'draft' && p.section.number.trim().startsWith(`${n}.`))
      if (children.length === 0) continue
      const lastIndex = Math.max(...children.map(c => c.i))
      placed.add(n)
      out.splice(lastIndex + 1, 0, {
        section: s, stageKey: out[lastIndex]!.stageKey, stageLabel: out[lastIndex]!.stageLabel, mode: 'draft',
        dependsOn: children.map(c => c.p.section.number.trim()), rules: { sectionIntro: true, noNewFacts: true },
      })
    }
  }

  for (const s of sections) {
    const n = s.number.trim()
    if (placed.has(n)) continue
    const mode = codeBuilt.has(n) && !headings.has(n) ? 'code' : 'heading'
    out.push({ section: s, stageKey: mode, stageLabel: mode === 'code' ? 'Built by code' : 'Main headings', mode, dependsOn: [], rules: {} })
  }
  return out
}

/** Per earlier section, at most this much of its text is passed on (a summary depends on all of them). */
const MAX_DEP_CHARS = 12_000
const MAX_ALL_DEPS_CHARS = 240_000

/**
 * The earlier sections a section is given, in drafting order: the ones it names, or every section drafted before it
 * ('*'). Sections with no text yet are left out.
 */
export function earlierSectionsFor<S extends { id: string; number: string; title: string }>(
  planned: Array<PlannedSection<S>>,
  index: number,
  contentOf: (sectionId: string) => string | null | undefined,
): Array<{ number: string; title: string; html: string }> {
  const me = planned[index]!
  const before = planned.slice(0, index).filter(p => p.mode === 'draft')
  const wanted = me.dependsOn === '*' ? before : before.filter(p => (me.dependsOn as string[]).includes(p.section.number.trim()))
  const out: Array<{ number: string; title: string; html: string }> = []
  let total = 0
  for (const p of wanted) {
    const html = (contentOf(p.section.id) ?? '').trim()
    if (!html) continue
    const cut = html.length > MAX_DEP_CHARS ? `${html.slice(0, MAX_DEP_CHARS)}\n[… section continues]` : html
    if (total + cut.length > MAX_ALL_DEPS_CHARS) break
    total += cut.length
    out.push({ number: p.section.number, title: p.section.title, html: cut })
  }
  return out
}

/** The part of a section's prompt that comes from the plan. Empty when there is nothing to add. */
export function planPromptBlock(args: {
  earlier: Array<{ number: string; title: string; html: string }>
  rules: PlannedSection<unknown>['rules']
}): string {
  const parts: string[] = []
  if (args.earlier.length > 0) {
    parts.push(
      'EARLIER SECTIONS OF THIS DOCUMENT (already drafted). Keep every fact in this section consistent with them: the same study details, numbers, doses, visits and endpoints. Do not contradict them; refer to them rather than repeating them unless this section needs the detail.',
      ...args.earlier.map(s => `--- ${s.number} ${s.title} ---\n${s.html}`),
    )
  }
  if (args.rules.sectionIntro) {
    parts.push(SECTION_INTRO_RULE)
  } else if (args.rules.noNewFacts) {
    parts.push('THIS SECTION SUMMARISES THE DOCUMENT. Use only facts stated in the earlier sections above. Add no fact that is not in them, even if a source has it; where something the summary needs is missing from them, write [TBD: what is needed].')
  }
  if (args.rules.exampleWording) {
    parts.push('Standard wording from EXAMPLE sources may be reused in this section. Facts still come only from EVIDENCE sources.')
  }
  return parts.join('\n\n')
}

/**
 * What a main heading's introduction is told. The API's heading redraft (documents/heading-intro.ts) sends the same
 * text; a test keeps the two equal.
 */
export const SECTION_INTRO_RULE = [
  'THIS IS A MAIN SECTION HEADING. Write its introduction, after which its sub-sections (given above) follow in the document.',
  '- Follow the template guidance for this section, at the length it needs.',
  '- Use only facts stated in the sub-sections above (and the study fact sheet). Add no fact that is not in them, even if a source has it; where the guidance asks for something they do not state, write [TBD: what is needed].',
  '- Do not repeat the sub-sections at length: summarise them and refer the reader to them (with cross-reference markers when the instructions ask for them).',
].join('\n')
